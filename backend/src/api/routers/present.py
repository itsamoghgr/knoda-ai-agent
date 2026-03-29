"""Presentation mode router — TTS and Communication Agent session endpoints.

Endpoints:
  POST /present/tts                          → OpenAI TTS, returns MP3 audio
  POST /present/{dashboard_id}/session       → create a new presentation session
  POST /present/session/{session_id}/ask     → unified SSE: narration (empty msg) or Q&A
  DELETE /present/session/{session_id}       → clean up session
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from agents.communication import build_communication_agent
from agents.core import AgentToolsContext, build_llm
from api.dependencies import CurrentUser, get_current_user
from api.rate_limit import limiter
from storage.database import AsyncSessionFactory
from storage.redis_client import get_redis
from storage.repositories.charts_repo import DashboardRepository
from storage.repositories.settings_repo import SettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/present", tags=["presentation"])


# ── Session store (Redis-backed) ────────────────────────────────────────────
#
#   KEY:   session:{session_id}
#   VALUE: JSON {session_id, dashboard_id, tenant_id, history, last_accessed}
#   TTL:   4 hours, refreshed on every /ask call (GETEX)
#
#   TTL handles eviction automatically — no background cleanup task needed.
#   Any worker can serve any session — multi-worker deployment unlocked.

_SESSION_PREFIX = "present_session:"
SESSION_TTL = 3_600   # 1 hour in seconds
MAX_HISTORY_EXCHANGES = 10


@dataclass
class PresentationSession:
    session_id: str
    dashboard_id: str
    tenant_id: str = ""
    history: list[dict] = field(default_factory=list)
    last_accessed: str = field(default_factory=lambda: datetime.utcnow().isoformat())


def _skey(session_id: str, tenant_id: str = "") -> str:
    if tenant_id:
        return f"{_SESSION_PREFIX}{tenant_id}:{session_id}"
    return f"{_SESSION_PREFIX}{session_id}"


async def _save_session(session: PresentationSession) -> None:
    payload = json.dumps(asdict(session))
    await get_redis().set(_skey(session.session_id, session.tenant_id), payload, ex=SESSION_TTL)


async def _load_session(session_id: str, tenant_id: str = "") -> PresentationSession | None:
    """Load and TTL-refresh the session in one atomic GETEX call."""
    raw = await get_redis().getex(_skey(session_id, tenant_id), ex=SESSION_TTL)
    if raw is None:
        return None
    data = json.loads(raw)
    return PresentationSession(**data)


async def _delete_session(session_id: str, tenant_id: str = "") -> None:
    await get_redis().delete(_skey(session_id, tenant_id))


# start_session_cleanup is no longer needed — Redis TTL handles eviction.
# It remains as a no-op to avoid import errors from any callers in main.py.
def start_session_cleanup() -> asyncio.Task:
    """Deprecated: Redis TTL handles session eviction automatically."""
    async def _noop() -> None:
        pass
    return asyncio.create_task(_noop())


# ── Schemas ───────────────────────────────────────────────────────────────────


class TtsRequest(BaseModel):
    text: str = Field(..., max_length=4_096)   # OpenAI TTS hard limit
    voice: str = Field("alloy", max_length=20)


class AskRequest(BaseModel):
    # Empty string = start of presentation (agent narrates).
    # Any other value = audience question (agent answers).
    message: str = Field("", max_length=2_000)


# ── TTS endpoint ─────────────────────────────────────────────────────────────


@router.post("/tts")
@limiter.limit("20/minute")
async def text_to_speech(
    request: Request,
    body: TtsRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Convert text to speech using OpenAI TTS. Returns raw MP3 audio bytes.

    Requires an OpenAI API key configured in Settings → AI Memory.
    """
    async with AsyncSessionFactory() as session:
        repo = SettingsRepository(session, current_user.id)
        api_key = await repo.get_embedding_api_key()

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "OpenAI API key not configured. TTS requires an OpenAI API key. "
                "Go to Settings → AI Memory to add one."
            ),
        )

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key)
        response = await client.audio.speech.create(
            model="tts-1",
            voice=body.voice,  # type: ignore[arg-type]
            input=body.text,
        )
        return Response(
            content=response.content,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("TTS error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"TTS failed: {exc}") from exc


# ── Session lifecycle endpoints ───────────────────────────────────────────────


@router.post("/{dashboard_id}/session")
async def create_session(
    dashboard_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a new presentation session, stored in Redis with a 1-hour TTL."""
    # Verify the dashboard belongs to the current user's tenant
    async with AsyncSessionFactory() as db:
        dashboard = await DashboardRepository(db, current_user.id).get(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    session_id = str(uuid.uuid4())
    session = PresentationSession(
        session_id=session_id,
        dashboard_id=dashboard_id,
        tenant_id=current_user.id,
    )
    try:
        await _save_session(session)
    except Exception as exc:
        logger.error("Failed to save presentation session to Redis: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Session storage is temporarily unavailable. Please try again.",
        ) from exc
    logger.info(
        "Created presentation session %s for dashboard %s",
        session_id[:8], dashboard_id[:8],
    )
    return {"session_id": session_id}


@router.delete("/session/{session_id}")
async def delete_session(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Clean up a presentation session on exit."""
    session = await _load_session(session_id, current_user.id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    await _delete_session(session_id, current_user.id)
    logger.info("Deleted presentation session %s", session_id[:8])
    return {"deleted": session_id}


# ── Unified ask endpoint (SSE) ────────────────────────────────────────────────


@router.post("/session/{session_id}/ask")
async def ask_session(
    session_id: str,
    body: AskRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> EventSourceResponse:
    """Unified Communication Agent endpoint.

    Empty message → agent discovers dashboard via tools and narrates.
    Non-empty message → agent answers the audience question.

    Streams the same SSE events as /agent:
      token       → {"token": "..."}
      tool_call   → {"id": "...", "name": "...", "input": "..."}
      tool_result → {"id": "...", "rows": [...], "text": "...", "truncated": bool, "error": null}
      done        → {}
      error       → {"message": "..."}

    Session history is maintained server-side — no history in the request body.
    """
    # Load session scoped to this tenant — tenant_id in key is implicit ownership check
    session = await _load_session(session_id, current_user.id)
    if not session:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found. Start a new presentation.",
        )

    session.last_accessed = datetime.utcnow().isoformat()

    # Load LLM config
    async with AsyncSessionFactory() as db:
        repo = SettingsRepository(db, session.tenant_id)
        provider, api_key, model = await repo.get_llm_config()

    if not provider or not model:
        raise HTTPException(
            status_code=400,
            detail="LLM not configured. Go to Settings and select a provider and model.",
        )
    if not api_key and provider != "ollama":
        raise HTTPException(
            status_code=400,
            detail=f"No API key set for {provider}. Go to Settings and save your API key.",
        )

    llm = build_llm(provider=provider, api_key=api_key or "", model=model)
    dashboard_id = session.dashboard_id
    # Snapshot history before streaming starts to avoid mutation mid-stream
    history_snapshot = list(session.history)
    current_message = body.message

    async def stream_response():
        from models.connection import SourceConfig
        from query_engine.engine import QueryEngine
        from storage import source_config_cache
        from storage.repositories import JobRepository

        tenant_id = session.tenant_id
        with QueryEngine() as engine:
            # Load all connected databases for this tenant
            all_cached = source_config_cache.all_configs()
            prefix = f"{tenant_id}:" if tenant_id else ""
            job_configs: dict[str, SourceConfig] = (
                {k[len(prefix):]: v for k, v in all_cached.items() if k.startswith(prefix)}
                if prefix else dict(all_cached)
            )
            if not job_configs:
                async with AsyncSessionFactory() as jr_session:
                    raw_configs = await JobRepository(jr_session, tenant_id).list_all_source_configs()
                for jid, raw in raw_configs.items():
                    try:
                        cfg = SourceConfig(**raw)
                        source_config_cache.store(jid, cfg, tenant_id=tenant_id)
                        job_configs[jid] = cfg
                    except Exception as exc:
                        logger.warning(
                            "CommAgent: could not load SourceConfig for job %s: %s", jid, exc
                        )

            alias_map: dict[str, str] = {}
            for jid, cfg in job_configs.items():
                try:
                    alias = engine.attach(cfg)
                    alias_map[jid] = alias
                    logger.info(
                        "CommAgent: attached job %s as alias '%s'", jid[:8], alias
                    )
                except Exception as exc:
                    logger.warning(
                        "CommAgent: could not attach DB for job %s: %s", jid[:8], exc
                    )

            ctx = AgentToolsContext(
                job_id=next(iter(job_configs), ""),
                engine=engine,
                session_factory=AsyncSessionFactory,
                tenant_id=session.tenant_id,
                alias_map=alias_map,
            )

            agent = build_communication_agent(llm, ctx, dashboard_id=dashboard_id)

            # Build LangChain message list from session history + current message
            lc_messages: list = []
            for h in history_snapshot:
                if h["role"] == "user" and h.get("content"):   # skip empty — Anthropic rejects them
                    lc_messages.append(HumanMessage(content=h["content"]))
                elif h["role"] == "assistant" and h.get("content"):
                    lc_messages.append(AIMessage(content=h["content"]))
            # Anthropic rejects empty-string messages — convert the narration trigger
            # to an explicit instruction. The agent's prompt handles this case.
            effective_message = current_message.strip() or "Please begin your presentation of this dashboard now."
            lc_messages.append(HumanMessage(content=effective_message))

            total_input_tokens = 0
            total_output_tokens = 0
            active_tool_run_id: str | None = None
            full_response = ""

            try:
                async for ev in agent.astream_events(
                    {"messages": lc_messages},
                    version="v2",
                    config={"recursion_limit": 100},
                ):
                    etype = ev["event"]

                    # ── LLM text tokens ───────────────────────────────────────
                    if etype == "on_chat_model_stream":
                        chunk = ev["data"].get("chunk")
                        if chunk is not None:
                            content = chunk.content if hasattr(chunk, "content") else ""
                            if isinstance(content, str) and content:
                                full_response += content
                                yield {
                                    "event": "token",
                                    "data": json.dumps({"token": content}),
                                }
                            elif isinstance(content, list):
                                for block in content:
                                    if (
                                        isinstance(block, dict)
                                        and block.get("type") == "text"
                                    ):
                                        t = block.get("text", "")
                                        if t:
                                            full_response += t
                                            yield {
                                                "event": "token",
                                                "data": json.dumps({"token": t}),
                                            }

                    # ── Token usage tracking ──────────────────────────────────
                    elif etype == "on_chat_model_end":
                        output = ev["data"].get("output")
                        if output:
                            meta = None
                            if (
                                hasattr(output, "usage_metadata")
                                and output.usage_metadata
                            ):
                                meta = output.usage_metadata
                            elif (
                                hasattr(output, "response_metadata")
                                and output.response_metadata
                            ):
                                rm = output.response_metadata
                                raw_usage = (
                                    rm.get("usage")
                                    or rm.get("token_usage")
                                    or rm.get("usage_metadata")
                                )
                                if raw_usage and isinstance(raw_usage, dict):
                                    meta = {
                                        "input_tokens": (
                                            raw_usage.get("input_tokens")
                                            or raw_usage.get("prompt_tokens")
                                            or 0
                                        ),
                                        "output_tokens": (
                                            raw_usage.get("output_tokens")
                                            or raw_usage.get("completion_tokens")
                                            or 0
                                        ),
                                    }
                            if meta:
                                total_input_tokens += meta.get("input_tokens", 0)
                                total_output_tokens += meta.get("output_tokens", 0)

                    # ── Tool call start ───────────────────────────────────────
                    elif etype == "on_tool_start":
                        tool_name = ev.get("name", "tool")
                        run_id = ev.get("run_id", str(uuid.uuid4()))
                        active_tool_run_id = run_id
                        raw_input = ev["data"].get("input", {})
                        if isinstance(raw_input, dict):
                            tool_input = (
                                raw_input.get("sql")
                                or raw_input.get("dashboard_id")
                                or raw_input.get("table_fqn")
                                or raw_input.get("query")
                                or json.dumps(raw_input)
                            )
                        else:
                            tool_input = str(raw_input)
                        yield {
                            "event": "tool_call",
                            "data": json.dumps({
                                "id": run_id,
                                "name": tool_name,
                                "input": tool_input,
                            }),
                        }

                    # ── Tool call result ──────────────────────────────────────
                    elif etype == "on_tool_end":
                        run_id = ev.get("run_id", active_tool_run_id or "")
                        raw_output = ev["data"].get("output", "")
                        if hasattr(raw_output, "content"):
                            raw_output = raw_output.content

                        rows: list = []
                        text: str | None = None
                        truncated = False
                        error: str | None = None

                        try:
                            parsed = (
                                json.loads(raw_output)
                                if isinstance(raw_output, str)
                                else raw_output
                            )
                            if isinstance(parsed, dict):
                                rows = parsed.get("rows", [])
                                truncated = parsed.get("truncated", False)
                                error = parsed.get("error")
                                if not rows and not error:
                                    text = str(raw_output)
                            else:
                                text = str(raw_output)
                        except (json.JSONDecodeError, TypeError):
                            text = str(raw_output) if raw_output else None

                        yield {
                            "event": "tool_result",
                            "data": json.dumps({
                                "id": run_id,
                                "rows": rows,
                                "text": text,
                                "truncated": truncated,
                                "error": error,
                            }),
                        }

                # ── Save token usage ──────────────────────────────────────────
                if total_input_tokens or total_output_tokens:
                    try:
                        from storage.repositories import TokenUsageRepository

                        async with AsyncSessionFactory() as usage_session:
                            await TokenUsageRepository(usage_session, session.tenant_id).record(
                                provider=provider,
                                model=model,
                                context="communication_agent",
                                input_tokens=total_input_tokens,
                                output_tokens=total_output_tokens,
                                job_id=None,
                            )
                    except Exception as tok_exc:
                        logger.warning("Could not save token usage: %s", tok_exc)

                # ── Update session history in Redis ───────────────────────────
                if full_response.strip():
                    updated = [
                        *history_snapshot,
                        {"role": "user", "content": effective_message},
                        {"role": "assistant", "content": full_response.strip()},
                    ]
                    max_messages = MAX_HISTORY_EXCHANGES * 2
                    session.history = (
                        updated[-max_messages:]
                        if len(updated) > max_messages
                        else updated
                    )
                    await _save_session(session)  # write updated history to Redis

                yield {"event": "done", "data": "{}"}

            except Exception as exc:
                logger.error("Communication agent error: %s", exc, exc_info=True)
                yield {"event": "error", "data": json.dumps({"message": "An error occurred. Please try again."})}

    return EventSourceResponse(stream_response())
