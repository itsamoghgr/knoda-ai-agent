"""SQL Lab router — execute ad-hoc read-only SQL against connected databases."""

import asyncio
import concurrent.futures
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.dependencies import CurrentUser, get_current_user, get_job_repo
from api.rate_limit import limiter
from models.connection import SourceConfig
from storage import source_config_cache
from storage.repositories import JobRepository
from query_engine.engine import QueryEngine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sql", tags=["sql-lab"])

# The alias assigned to the first (and only) attached database in SQL Lab queries.
# QueryEngine._alias_counter starts at 0, so the first attach always returns "src0".
DB_ALIAS = "src0"


class SqlRequest(BaseModel):
    job_id: str
    sql: str


class SqlResponse(BaseModel):
    rows: list[dict]
    columns: list[str]
    row_count: int
    truncated: bool
    execution_time_ms: int
    error: str | None = None


class SchemaTable(BaseModel):
    schema_name: str
    table_name: str
    table_type: str       # "BASE TABLE" | "VIEW"
    qualified_name: str   # e.g. "src0.public.users"


class SchemaResponse(BaseModel):
    alias: str            # always "src0" for single-db SQL Lab queries
    tables: list[SchemaTable]
    error: str | None = None


@router.post("", response_model=SqlResponse)
@limiter.limit("60/minute")
async def run_sql_query(
    request: Request,
    body: SqlRequest,
    job_repo: JobRepository = Depends(get_job_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> SqlResponse:
    """Execute a read-only SQL query against a connected database.

    Returns up to `limit` rows (default 500). All errors are returned in the
    `error` field rather than raising HTTP exceptions, so the frontend can
    display them inline.
    """
    # ── Resolve source config (cache-first, DB fallback) ─────────────────────
    cfg: SourceConfig | None = source_config_cache.get(body.job_id, tenant_id=current_user.id)
    if cfg is None:
        raw = await job_repo.get_source_config(body.job_id)
        if raw:
            try:
                cfg = SourceConfig(**raw)
                source_config_cache.store(body.job_id, cfg, tenant_id=current_user.id)
            except Exception as exc:
                logger.warning("Could not reconstruct SourceConfig for job %s: %s", body.job_id, exc)

    if cfg is None:
        # Check job even exists
        job = await job_repo.get(body.job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return SqlResponse(
            rows=[],
            columns=[],
            row_count=0,
            truncated=False,
            execution_time_ms=0,
            error=(
                "No connection credentials found for this job. "
                "The server may have restarted before the job's credentials were stored. "
                "Try re-connecting the database."
            ),
        )

    # ── Execute query in ThreadPoolExecutor (DuckDB is synchronous) ──────────
    loop = asyncio.get_running_loop()
    start = time.monotonic()

    def _run() -> tuple[list[dict], str | None]:
        try:
            with QueryEngine() as engine:
                engine.attach(cfg)
                rows = engine.execute_unlimited(body.sql)
            return rows, None
        except Exception as exc:
            return [], str(exc)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        rows, error = await loop.run_in_executor(pool, _run)

    elapsed_ms = int((time.monotonic() - start) * 1000)

    if error:
        return SqlResponse(
            rows=[],
            columns=[],
            row_count=0,
            truncated=False,
            execution_time_ms=elapsed_ms,
            error=error,
        )

    columns = list(rows[0].keys()) if rows else []

    return SqlResponse(
        rows=rows,
        columns=columns,
        row_count=len(rows),
        truncated=False,
        execution_time_ms=elapsed_ms,
        error=None,
    )


@router.get("/schema", response_model=SchemaResponse)
async def get_schema(
    job_id: str,
    job_repo: JobRepository = Depends(get_job_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> SchemaResponse:
    """Return available schemas and tables for a connected database.

    Uses information_schema.tables so it works across all supported source types.
    The alias is always 'src0' since SQL Lab creates a fresh QueryEngine per request.
    """
    cfg: SourceConfig | None = source_config_cache.get(job_id, tenant_id=current_user.id)
    if cfg is None:
        raw = await job_repo.get_source_config(job_id)
        if raw:
            try:
                cfg = SourceConfig(**raw)
                source_config_cache.store(job_id, cfg, tenant_id=current_user.id)
            except Exception as exc:
                logger.warning("Could not reconstruct SourceConfig for job %s: %s", job_id, exc)

    if cfg is None:
        job = await job_repo.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return SchemaResponse(
            alias=DB_ALIAS,
            tables=[],
            error="No connection credentials found. The server may have restarted — try re-connecting the database.",
        )

    loop = asyncio.get_running_loop()

    def _fetch_tables() -> tuple[list[SchemaTable], str | None]:
        try:
            with QueryEngine() as engine:
                engine.attach(cfg)
                # information_schema.tables is available in both PostgreSQL and MySQL
                # via DuckDB's ATTACH bridge. Filter out system schemas.
                schema_sql = f"""
                    SELECT table_schema, table_name, table_type
                    FROM {DB_ALIAS}.information_schema.tables
                    WHERE table_schema NOT IN (
                        'pg_catalog', 'information_schema', 'pg_toast',
                        'performance_schema', 'sys', 'mysql'
                    )
                    ORDER BY table_schema, table_name
                """
                rows = engine.execute_raw(schema_sql)
            tables = [
                SchemaTable(
                    schema_name=str(r.get("table_schema", "")),
                    table_name=str(r.get("table_name", "")),
                    table_type=str(r.get("table_type", "BASE TABLE")),
                    qualified_name=f"{DB_ALIAS}.{r.get('table_schema', '')}.{r.get('table_name', '')}",
                )
                for r in rows
            ]
            return tables, None
        except Exception as exc:
            return [], str(exc)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        tables, error = await loop.run_in_executor(pool, _fetch_tables)

    return SchemaResponse(alias=DB_ALIAS, tables=tables, error=error)
