"""Unified agent endpoint — single POST /agent for all AI interactions.

The LangGraph Supervisor routes to the appropriate sub-agent:
  - discovery_agent: catalogs database tables (explore, classify, save)
  - analyst_agent:   answers data questions using SQL

For live meeting voice Q&A use POST /present/session/{id}/ask (Communication Agent).

SSE events streamed:
  token       → {"token": "..."}
  tool_call   → {"id": "...", "name": "...", "input": "..."}
  tool_result → {"id": "...", "rows": [...], "text": "...", "truncated": bool, "error": null}
  done        → {}
  error       → {"message": "..."}
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

# ── Per-tenant abort registry ─────────────────────────────────────────────────
# Maps tenant_id → asyncio.Event. Set the event to abort all in-flight streams
# for that tenant (e.g. when the active LLM provider is changed).
_active_streams: dict[str, asyncio.Event] = {}


def abort_tenant_streams(tenant_id: str) -> None:
    """Signal any in-flight agent SSE stream for this tenant to stop."""
    event = _active_streams.get(tenant_id)
    if event:
        event.set()

from fastapi import APIRouter, Depends, HTTPException, Request
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api.rate_limit import limiter

from agents.analyst import build_analyst_agent
from agents.core import AgentToolsContext, build_llm
from agents.discovery import build_discovery_agent
from agents.supervisor import build_supervisor
from api.dependencies import CurrentUser, get_current_user
from models.connection import SourceConfig
from storage import source_config_cache
from storage.database import AsyncSessionFactory
from storage.repositories import JobRepository
from storage.repositories.long_term_repo import ConversationRepository
from storage.repositories.settings_repo import SettingsRepository, format_business_context_for_agent
from storage.redis_client import get_checkpointer

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent"])

# ── Friendly status labels for tool calls ─────────────────────────────────────
_TOOL_STATUS_LABELS: dict[str, str] = {
    "get_semantic_catalog": "Reading data catalog…",
    "find_existing_dataset": "Checking memory…",
    "search_tables": "Searching tables…",
    "describe_table": "Inspecting table structure…",
    "get_relationships": "Loading relationships…",
    "execute_sql": "Running query…",
    "create_chart": "Creating chart…",
    "list_charts": "Loading charts…",
    "list_dashboards": "Loading dashboards…",
    "find_similar_dashboards": "Checking for similar dashboards…",
    "create_dashboard": "Creating dashboard…",
    "get_dashboard_charts": "Loading dashboard charts…",
    "add_chart_to_dashboard": "Adding chart to dashboard…",
    "list_databases": "Listing databases…",
    "speak_tts": "Generating audio…",
    "search_dashboards": "Searching dashboards…",
    "schedule_meeting_presentation": "Scheduling meeting…",
    "reschedule_meeting": "Rescheduling meeting…",
    "list_meetings": "Loading scheduled meetings…",
}

# Patterns to strip from streamed tokens
_ROUTING_PATTERNS = [
    "DIRECT:",
    "ROUTE:analyst",
    "ROUTE:discovery",
]

import re
_ROUTE_TAG_RE = re.compile(r"<route>\s*(?:analyst|discovery)\s*</route>")


def _clean_token(token: str) -> str:
    """Strip routing signals from a token before sending to the frontend."""
    # Strip XML-style <route>xxx</route>
    token = _ROUTE_TAG_RE.sub("", token)
    # Strip legacy prefix signals
    for pattern in _ROUTING_PATTERNS:
        token = token.replace(pattern, "")
    return token


class HistoryMessage(BaseModel):
    role: str = Field(..., max_length=20)
    content: str = Field(..., max_length=32_000)


class AgentRequest(BaseModel):
    job_id: str | None = Field(None, max_length=36)
    message: str = Field(..., min_length=1, max_length=8_000)
    history: list[HistoryMessage] = Field(default=[], max_length=50)
    session_id: str | None = Field(None, max_length=36)
    channel: str = Field("chat", max_length=20)


@router.post("/agent")
@limiter.limit("30/minute")
async def run_agent(
    request: Request,
    body: AgentRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> EventSourceResponse:
    """
    Unified agent endpoint. The supervisor LLM decides which sub-agent handles
    the request based on the message content.

    Streams SSE events as the agent thinks, calls tools, and responds.
    """
    tenant_id = current_user.id

    # ── Validate LLM config ───────────────────────────────────────────────────
    async with AsyncSessionFactory() as _settings_session:
        _settings_repo = SettingsRepository(_settings_session, tenant_id)
        provider, api_key, model = await _settings_repo.get_llm_config()
        _biz_fields = await _settings_repo.get_business_context()
        business_context = format_business_context_for_agent(_biz_fields)
    if not provider or not model:
        raise HTTPException(
            status_code=400,
            detail="LLM is not configured. Go to Settings and select a provider and model.",
        )
    if not api_key and provider != "ollama":
        raise HTTPException(
            status_code=400,
            detail=f"No API key set for {provider}. Go to Settings and save your API key.",
        )

    # ── Build LLM, injecting 429 retry-notification hook for Anthropic ───────
    retry_queue: asyncio.Queue[str] = asyncio.Queue()

    if provider == "anthropic" and api_key:
        import httpx
        import anthropic as _anthropic
        from langchain_anthropic import ChatAnthropic

        async def _on_response(response: httpx.Response) -> None:
            if response.status_code == 429:
                ra = (
                    response.headers.get("retry-after")
                    or response.headers.get("x-ratelimit-reset-requests")
                )
                wait = f"{ra}s" if ra else "a moment"
                retry_queue.put_nowait(f"Rate limit reached — retrying in {wait}…")

        _http_client = httpx.AsyncClient(event_hooks={"response": [_on_response]})
        _anthropic_client = _anthropic.AsyncAnthropic(
            api_key=api_key,
            http_client=_http_client,
        )
        llm = ChatAnthropic(model=model, api_key=api_key)
        # Bypass the cached_property by injecting our pre-built client
        llm.__dict__["_async_client"] = _anthropic_client
    else:
        llm = build_llm(provider=provider, api_key=api_key or "", model=model)

    # ── Register abort event for this tenant ──────────────────────────────────
    abort_event = asyncio.Event()
    _active_streams[tenant_id] = abort_event

    # ── Resolve source configs (cache-first, DB fallback) ─────────────────────
    job_configs: dict[str, SourceConfig] = {}

    if body.job_id:
        cached = source_config_cache.get(body.job_id, tenant_id=tenant_id)
        if cached:
            job_configs = {body.job_id: cached}
        else:
            async with AsyncSessionFactory() as _jr_session:
                raw = await JobRepository(_jr_session, tenant_id).get_source_config(body.job_id)
            if raw:
                try:
                    cfg = SourceConfig(**raw)
                    source_config_cache.store(body.job_id, cfg, tenant_id=tenant_id)
                    job_configs = {body.job_id: cfg}
                except Exception as exc:
                    logger.warning(
                        "Could not reconstruct SourceConfig for job %s: %s",
                        body.job_id, exc,
                    )
    else:
        # Only get configs for this tenant from cache
        all_cached = source_config_cache.all_configs()
        prefix = f"{tenant_id}:"
        job_configs = {
            k[len(prefix):]: v for k, v in all_cached.items() if k.startswith(prefix)
        }
        if not job_configs:
            async with AsyncSessionFactory() as _jr_session:
                raw_configs = await JobRepository(_jr_session, tenant_id).list_all_source_configs()
            for jid, raw in raw_configs.items():
                try:
                    cfg = SourceConfig(**raw)
                    source_config_cache.store(jid, cfg, tenant_id=tenant_id)
                    job_configs[jid] = cfg
                except Exception as exc:
                    logger.warning("Could not reconstruct SourceConfig for job %s: %s", jid, exc)

    _job_id = body.job_id

    async def stream_response() -> AsyncGenerator[dict, None]:
        from query_engine.engine import QueryEngine

        with QueryEngine() as engine:
            # Attach all source databases and build alias map
            alias_map: dict[str, str] = {}
            for jid, cfg in job_configs.items():
                try:
                    alias = engine.attach(cfg)
                    alias_map[jid] = alias
                    logger.info("Agent: attached job %s as alias '%s'", jid[:8], alias)
                except Exception as exc:
                    logger.warning("Agent: could not attach DB for job %s: %s", jid[:8], exc)

            # Build the shared tools context — each tool opens its own short-lived session
            ctx = AgentToolsContext(
                job_id=_job_id or (next(iter(job_configs)) if job_configs else ""),
                engine=engine,
                session_factory=AsyncSessionFactory,
                tenant_id=tenant_id,
                alias_map=alias_map,
            )

            # Build specialized sub-agents and supervisor
            discovery_agent, _max_iter = build_discovery_agent(llm, ctx)
            analyst_agent = build_analyst_agent(
                llm,
                ctx,
                business_context=business_context,
            )

            # v2: wire Redis checkpointer if session_id provided
            _checkpointer = None
            _thread_config: dict = {"recursion_limit": 150}
            if body.session_id:
                _checkpointer = get_checkpointer()
                if _checkpointer is not None:
                    thread_id = f"{tenant_id}:{_job_id or 'global'}:{body.session_id}"
                    _thread_config["configurable"] = {"thread_id": thread_id}
                    logger.info("Agent: short-term memory enabled, thread_id=%s", thread_id)

            _now_utc = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            agent_to_run = build_supervisor(
                llm, discovery_agent, analyst_agent, ctx=ctx, current_utc_time=_now_utc
            )

            # Build message list for the agent
            lc_messages: list = []
            for h in body.history:
                if h.role == "user":
                    lc_messages.append(HumanMessage(content=h.content))
                elif h.role == "assistant" and h.content:
                    lc_messages.append(AIMessage(content=h.content))
            lc_messages.append(HumanMessage(content=body.message))

            # Token tracking
            total_input_tokens = 0
            total_output_tokens = 0
            active_tool_run_id: str | None = None
            final_assistant_content: list[str] = []  # v2: collect for audit log
            final_tool_calls: dict = {}              # v2: collect tool call metadata
            # Per-request tool call counters for progress labels (e.g. "Creating chart (3)…")
            tool_call_counts: dict[str, int] = {}
            _COUNTABLE_TOOLS = {"create_chart", "execute_sql", "describe_table"}

            try:
                async for ev in agent_to_run.astream_events(
                    {"messages": lc_messages},
                    version="v2",
                    subgraphs=True,
                    config=_thread_config,
                ):
                    if abort_event.is_set():
                        yield {
                            "event": "error",
                            "data": json.dumps({"message": "LLM provider changed — please resend your message."}),
                        }
                        return

                    etype = ev["event"]

                    # ── LLM text tokens ───────────────────────────────────────
                    if etype == "on_chat_model_stream":
                        chunk = ev["data"].get("chunk")
                        if chunk is not None:
                            content = chunk.content if hasattr(chunk, "content") else ""
                            if isinstance(content, str) and content:
                                cleaned = _clean_token(content)
                                if cleaned:
                                    final_assistant_content.append(cleaned)
                                    yield {
                                        "event": "token",
                                        "data": json.dumps({"token": cleaned}),
                                    }
                            elif isinstance(content, list):
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        t = _clean_token(block.get("text", ""))
                                        if t:
                                            final_assistant_content.append(t)
                                            yield {
                                                "event": "token",
                                                "data": json.dumps({"token": t}),
                                            }

                    # ── Token usage tracking ──────────────────────────────────
                    elif etype == "on_chat_model_end":
                        output = ev["data"].get("output")
                        if output:
                            meta = None
                            if hasattr(output, "usage_metadata") and output.usage_metadata:
                                meta = output.usage_metadata
                            elif hasattr(output, "response_metadata") and output.response_metadata:
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
                                            or raw_usage.get("prompt_tokens") or 0
                                        ),
                                        "output_tokens": (
                                            raw_usage.get("output_tokens")
                                            or raw_usage.get("completion_tokens") or 0
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
                        # Extract the meaningful input string for display
                        if isinstance(raw_input, dict):
                            tool_input = (
                                raw_input.get("sql")
                                or raw_input.get("table_fqn")
                                or raw_input.get("database_alias")
                                or raw_input.get("model_json")
                                or raw_input.get("relationships_json")
                                or json.dumps(raw_input)
                            )
                        else:
                            tool_input = str(raw_input)

                        # Emit a friendly status event for agentic feel
                        tool_call_counts[tool_name] = tool_call_counts.get(tool_name, 0) + 1
                        count = tool_call_counts[tool_name]
                        base_label = _TOOL_STATUS_LABELS.get(tool_name, f"Working on {tool_name}…")
                        if tool_name in _COUNTABLE_TOOLS and count > 1:
                            status_text = base_label.rstrip("…") + f" ({count})…"
                        else:
                            status_text = base_label
                        yield {
                            "event": "status",
                            "data": json.dumps({"text": status_text}),
                        }
                        # Drain any pending retry notifications from the 429 hook
                        while not retry_queue.empty():
                            retry_msg = retry_queue.get_nowait()
                            yield {"event": "status", "data": json.dumps({"text": retry_msg})}

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

                        # Try to parse as JSON (execute_sql returns JSON)
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
                        # v2: track tool calls for audit log
                        tool_name_for_log = ev.get("name", "tool")
                        final_tool_calls[run_id] = {
                            "tool": tool_name_for_log,
                            "rows_count": len(rows),
                            "error": error,
                        }
                        # Drain retry queue after tool result (429s happen during LLM reasoning)
                        while not retry_queue.empty():
                            retry_msg = retry_queue.get_nowait()
                            yield {"event": "status", "data": json.dumps({"text": retry_msg})}

                # ── Save token usage ──────────────────────────────────────────
                if total_input_tokens or total_output_tokens:
                    try:
                        from storage.repositories import TokenUsageRepository

                        async with AsyncSessionFactory() as usage_session:
                            await TokenUsageRepository(usage_session, tenant_id).record(
                                provider=provider,
                                model=model,
                                context="agent",
                                input_tokens=total_input_tokens,
                                output_tokens=total_output_tokens,
                                job_id=body.job_id,
                            )
                    except Exception as tok_exc:
                        logger.warning("Could not save token usage: %s", tok_exc)

                # ── v2: Write conversation audit log ─────────────────────────
                if body.session_id:
                    try:
                        async with AsyncSessionFactory() as audit_session:
                            conv_repo = ConversationRepository(audit_session, tenant_id)
                            # User message
                            await conv_repo.save_message(
                                session_id=body.session_id,
                                role="user",
                                content=body.message,
                                job_id=body.job_id,
                                channel=body.channel,
                            )
                            # Assistant response — clean routing tags before persisting
                            assistant_text = _clean_token("".join(final_assistant_content)).strip()
                            if assistant_text:
                                await conv_repo.save_message(
                                    session_id=body.session_id,
                                    role="assistant",
                                    content=assistant_text,
                                    job_id=body.job_id,
                                    channel=body.channel,
                                    tool_calls=final_tool_calls or None,
                                )
                    except Exception as audit_exc:
                        logger.warning("Could not write conversation audit log: %s", audit_exc)

                yield {"event": "done", "data": "{}"}

            except Exception as exc:
                logger.error("Agent streaming error: %s", exc, exc_info=True)
                yield {"event": "error", "data": json.dumps({"message": "An error occurred. Please try again."})}
            finally:
                _active_streams.pop(tenant_id, None)

    return EventSourceResponse(stream_response())
