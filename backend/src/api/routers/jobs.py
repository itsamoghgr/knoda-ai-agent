"""Jobs router — create, track, and manage discovery jobs."""

import asyncio
import json
import logging
from collections.abc import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from langchain_core.messages import HumanMessage
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from agents.core import AgentToolsContext, build_llm
from agents.discovery import build_discovery_agent
from api.dependencies import CurrentUser, get_current_user, get_job_repo
from models.connection import SourceConfig
from models.job import Job, JobStatus, ProgressEvent
from semantic.serializer import to_dbt_yaml
from storage import source_config_cache
from storage.repositories import JobRepository, SemanticRepository
from storage.repositories.settings_repo import SettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])

# In-memory progress queues: job_id → asyncio.Queue of ProgressEvent | None
_progress_queues: dict[str, asyncio.Queue] = {}


class StartJobRequest(BaseModel):
    source_config: SourceConfig


class JobResponse(BaseModel):
    id: str
    status: str
    source_type: str
    tables_total: int
    tables_processed: int
    progress_pct: int
    error_message: str | None
    created_at: str
    updated_at: str
    completed_at: str | None
    duration_seconds: int | None = None
    source_config_safe: dict | None = None


def _to_response(job: Job) -> JobResponse:
    duration_seconds: int | None = None
    if job.completed_at and job.created_at:
        duration_seconds = max(0, int((job.completed_at - job.created_at).total_seconds()))

    return JobResponse(
        id=job.id,
        status=job.status.value,
        source_type=job.source_type,
        tables_total=job.tables_total,
        tables_processed=job.tables_processed,
        progress_pct=job.progress_pct,
        error_message=job.error_message,
        created_at=job.created_at.isoformat(),
        updated_at=job.updated_at.isoformat(),
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        duration_seconds=duration_seconds,
        source_config_safe=job.source_config_safe,
    )


@router.post("", status_code=202)
async def start_job(
    request: StartJobRequest,
    background_tasks: BackgroundTasks,
    job_repo: JobRepository = Depends(get_job_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Create a discovery job and start the discovery agent in the background."""
    job = Job(
        source_type=request.source_config.source_type.value,
        source_config_safe=request.source_config.to_safe_dict(),
    )
    job = await job_repo.create(job, source_config=request.source_config.to_storage_dict())

    # Keep in-memory cache for fast same-session access (keyed by tenant+job)
    source_config_cache.store(job.id, request.source_config, tenant_id=current_user.id)

    queue: asyncio.Queue[ProgressEvent | None] = asyncio.Queue()
    _progress_queues[job.id] = queue

    background_tasks.add_task(
        _run_discovery_job, job.id, current_user.id, request.source_config, queue
    )
    return _to_response(job)


@router.get("")
async def list_jobs(
    job_repo: JobRepository = Depends(get_job_repo),
) -> list[JobResponse]:
    jobs = await job_repo.list_all()
    return [_to_response(j) for j in jobs]


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    job_repo: JobRepository = Depends(get_job_repo),
) -> JobResponse:
    job = await job_repo.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _to_response(job)


@router.get("/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    _: CurrentUser = Depends(get_current_user),
) -> EventSourceResponse:
    """SSE endpoint — streams real-time discovery progress events."""

    async def event_generator() -> AsyncGenerator[dict, None]:
        queue = _progress_queues.get(job_id)
        if queue is None:
            yield {
                "event": "error",
                "data": json.dumps({"message": "Job not found or already completed"}),
            }
            return

        while True:
            try:
                event: ProgressEvent | None = await asyncio.wait_for(queue.get(), timeout=30.0)
            except TimeoutError:
                yield {"event": "ping", "data": ""}
                continue

            if event is None:
                yield {"event": "done", "data": json.dumps({"message": "Discovery complete"})}
                _progress_queues.pop(job_id, None)
                break

            yield {"event": "progress", "data": event.model_dump_json()}

    return EventSourceResponse(event_generator())


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    job_repo: JobRepository = Depends(get_job_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    deleted = await job_repo.delete(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found")
    source_config_cache.remove(job_id, tenant_id=current_user.id)


@router.patch("/{job_id}/source-config", status_code=200)
async def update_job_source_config(
    job_id: str,
    request: StartJobRequest,
    job_repo: JobRepository = Depends(get_job_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    """Update stored connection credentials without re-running discovery."""
    job = await job_repo.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await job_repo.update_source_config(
        job_id,
        source_config=request.source_config.to_storage_dict(),
        source_config_safe=request.source_config.to_safe_dict(),
    )
    source_config_cache.store(job_id, request.source_config, tenant_id=current_user.id)
    updated = await job_repo.get(job_id)
    return _to_response(updated)


# ---------------------------------------------------------------------------
# Background discovery task — uses the unified discovery agent
# ---------------------------------------------------------------------------


async def _run_discovery_job(
    job_id: str,
    tenant_id: str,
    source_config: SourceConfig,
    queue: asyncio.Queue,
) -> None:
    """
    Background coroutine: runs the discovery agent and persists all findings.
    Uses the unified discovery sub-agent from agents/discovery.py.
    """
    from storage import AsyncSessionFactory
    from storage.repositories import (
        RelationshipRepository,
        SchemaRepository,
        TokenUsageRepository,
    )

    async def _db(coro_fn):  # type: ignore[return]
        async with AsyncSessionFactory() as s:
            return await coro_fn(s)

    total_input_tokens = 0
    total_output_tokens = 0

    try:
        # ── 1. Load LLM config ────────────────────────────────────────────────
        db_provider, db_api_key, db_model = await _db(
            lambda s: SettingsRepository(s, tenant_id).get_llm_config()
        )

        if not db_provider or not db_model:
            await _db(lambda s: JobRepository(s, tenant_id).update_status(
                job_id, JobStatus.FAILED,
                error_message="LLM is not configured. Go to Settings and select a provider and model.",
            ))
            return

        if not db_api_key and db_provider != "ollama":
            await _db(lambda s: JobRepository(s, tenant_id).update_status(
                job_id, JobStatus.FAILED,
                error_message=f"No API key set for {db_provider}. Go to Settings and save your API key.",
            ))
            return

        llm = build_llm(provider=db_provider, api_key=db_api_key or "", model=db_model)

        # ── 2. Mark bootstrapping ─────────────────────────────────────────────
        await _db(lambda s: JobRepository(s, tenant_id).update_status(job_id, JobStatus.BOOTSTRAPPING))

        await queue.put(ProgressEvent(
            job_id=job_id,
            phase="bootstrap",
            message="Connecting to database…",
            progress_pct=5,
        ))

        # ── 3. Build QueryEngine and attach source ────────────────────────────
        from query_engine.engine import QueryEngine

        with QueryEngine() as engine:
            alias = engine.attach(source_config)
            logger.info("[Job %s] Discovery agent attached source as alias '%s'", job_id, alias)

            await queue.put(ProgressEvent(
                job_id=job_id,
                phase="bootstrap",
                message=f"Connected — alias '{alias}'. Starting schema exploration…",
                progress_pct=10,
            ))

            # ── 4. Build AgentToolsContext — each tool uses its own short-lived session ──
            ctx = AgentToolsContext(
                job_id=job_id,
                engine=engine,
                session_factory=AsyncSessionFactory,
                alias_map={job_id: alias},
            )

            # ── 5. Build and run discovery agent ──────────────────────────────
            discovery_agent, max_iterations = build_discovery_agent(llm, ctx)

            await _db(lambda s: JobRepository(s, tenant_id).update_status(job_id, JobStatus.RUNNING))
            await queue.put(ProgressEvent(
                job_id=job_id,
                phase="running",
                message="Discovery agent started — exploring database schema…",
                progress_pct=15,
            ))

            discovery_message = (
                f"Discover and catalog all tables in the database attached as alias '{alias}'. "
                f"For each table: explore its schema using describe_table, understand its purpose "
                f"and column meanings, then save a classification using save_classification. "
                f"After all tables are classified, save all detected relationships using "
                f"save_relationships."
            )

            accumulated: list[str] = []

            try:
                async for ev in discovery_agent.astream_events(
                    {"messages": [HumanMessage(content=discovery_message)]},
                    version="v2",
                    config={"recursion_limit": max_iterations},
                ):
                    etype = ev["event"]

                    if etype == "on_chat_model_stream":
                        # Discovery agent has no supervisor, but guard for safety
                        node = ev.get("metadata", {}).get("langgraph_node", "")
                        if node == "supervisor":
                            continue
                        chunk = ev["data"].get("chunk")
                        if chunk is not None:
                            content = chunk.content if hasattr(chunk, "content") else ""
                            if isinstance(content, str):
                                accumulated.append(content)
                            elif isinstance(content, list):
                                for block in content:
                                    if isinstance(block, dict) and block.get("type") == "text":
                                        accumulated.append(block.get("text", ""))

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

                        text = "".join(accumulated).strip()
                        accumulated.clear()
                        if text:
                            await queue.put(ProgressEvent(
                                job_id=job_id,
                                phase="thinking",
                                message=text,
                                progress_pct=_calc_progress(ctx),
                            ))

                    elif etype == "on_tool_start":
                        tool_name = ev.get("name", "tool")
                        raw_input = ev["data"].get("input", {})
                        if isinstance(raw_input, dict):
                            detail = (
                                raw_input.get("table_fqn")
                                or raw_input.get("database_alias")
                                or ""
                            )
                        else:
                            detail = str(raw_input)[:60]
                        msg = f"{tool_name}({detail})" if detail else f"{tool_name}()"
                        await queue.put(ProgressEvent(
                            job_id=job_id,
                            phase="running",
                            message=msg,
                            progress_pct=_calc_progress(ctx),
                            table_name=detail if "." in detail else None,
                        ))

            except Exception as agent_exc:
                logger.warning("[Job %s] Discovery agent loop ended: %s", job_id, agent_exc)
                if ctx.tables_saved > 0:
                    logger.info(
                        "[Job %s] Partial success — %d tables classified",
                        job_id, ctx.tables_saved,
                    )
                else:
                    raise

            # ── 6. Persist schema tables (from explore_schema calls) ──────────
            from tools.schema import describe_table as _describe_table

            loop = asyncio.get_event_loop()
            for table_meta in ctx.tables_discovered:
                try:
                    # If the agent never called describe_table for this table,
                    # columns will be empty — fetch them now before persisting.
                    if not table_meta.columns:
                        try:
                            full_meta = await loop.run_in_executor(
                                ctx.engine.executor,
                                _describe_table,
                                ctx.engine,
                                table_meta.database_name,
                                table_meta.schema_name,
                                table_meta.table_name,
                            )
                            table_meta = full_meta
                        except Exception as desc_exc:
                            logger.debug(
                                "[Job %s] Could not fetch columns for %s.%s: %s",
                                job_id, table_meta.schema_name, table_meta.table_name, desc_exc,
                            )

                    async with AsyncSessionFactory() as s2:
                        await SchemaRepository(s2).save_table(job_id, table_meta)
                except Exception as save_exc:
                    logger.debug("[Job %s] Could not save table meta: %s", job_id, save_exc)

        # ── 7. Finalize in PostgreSQL ─────────────────────────────────────────
        async def _finalize(s):
            from storage.repositories import TokenUsageRepository

            job_r = JobRepository(s, tenant_id)
            sem_r = SemanticRepository(s)

            await job_r.update_progress(
                job_id,
                ctx.tables_total or len(ctx.semantic_models_saved),
                ctx.tables_saved,
            )

            # Save dbt YAML snapshot
            if ctx.semantic_models_saved:
                yaml_content = to_dbt_yaml(ctx.semantic_models_saved)
                await sem_r.save_snapshot(job_id, yaml_content)

            # Record token usage
            if total_input_tokens or total_output_tokens:
                try:
                    await TokenUsageRepository(s, tenant_id).record(
                        provider=db_provider,
                        model=db_model,
                        context="discovery",
                        input_tokens=total_input_tokens,
                        output_tokens=total_output_tokens,
                        job_id=job_id,
                    )
                except Exception as tok_exc:
                    logger.warning("[Job %s] Could not save token usage: %s", job_id, tok_exc)

            await job_r.update_status(job_id, JobStatus.COMPLETED)
            logger.info(
                "[Job %s] Completed — %d models, %d relationships, %d total tokens",
                job_id,
                len(ctx.semantic_models_saved),
                len(ctx.relationships_saved),
                total_input_tokens + total_output_tokens,
            )

        await _db(_finalize)

        await queue.put(ProgressEvent(
            job_id=job_id,
            phase="done",
            message=(
                f"Discovery complete — {len(ctx.semantic_models_saved)} tables cataloged, "
                f"{len(ctx.relationships_saved)} relationships found."
            ),
            progress_pct=100,
        ))

    except Exception as exc:
        logger.exception("[Job %s] Unhandled error in discovery background task", job_id)
        try:
            await _db(lambda s: JobRepository(s, tenant_id).update_status(
                job_id, JobStatus.FAILED, error_message=str(exc),
            ))
        except Exception:
            logger.exception("[Job %s] Could not write FAILED status", job_id)

    finally:
        await queue.put(None)  # signal SSE stream to close


def _calc_progress(ctx: AgentToolsContext) -> int:
    """Map tables_saved / tables_total to 20–95% range."""
    if ctx.tables_total == 0:
        return 50
    return min(95, 20 + int((ctx.tables_saved / ctx.tables_total) * 75))
