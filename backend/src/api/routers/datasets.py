"""Datasets router — saved SQL queries scoped to a job (connected database)."""

import asyncio
import concurrent.futures
import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.dependencies import CurrentUser, get_current_user, get_job_repo
from models.connection import SourceConfig
from query_engine.engine import QueryEngine
from storage import snapshot_cache, source_config_cache
from storage.database import get_db
from storage.repositories import JobRepository
from storage.repositories.charts_repo import ChartRepository, DatasetRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/datasets", tags=["datasets"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class DatasetCreate(BaseModel):
    job_id: str
    name: str
    sql: str
    description: str = ""


class DatasetUpdate(BaseModel):
    name: str | None = None
    sql: str | None = None
    description: str | None = None


class DatasetResponse(BaseModel):
    id: str
    job_id: str
    name: str
    description: str
    sql: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class DatasetDataResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int
    execution_time_ms: int
    error: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DatasetResponse])
async def list_datasets(
    job_id: str | None = None,
    db=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[DatasetResponse]:
    repo = DatasetRepository(db, current_user.id)
    items = await repo.list(job_id=job_id)
    return [
        DatasetResponse(
            id=d.id,
            job_id=d.job_id,
            name=d.name,
            description=d.description,
            sql=d.sql,
            created_at=d.created_at.isoformat(),
            updated_at=d.updated_at.isoformat(),
        )
        for d in items
    ]


@router.post("", response_model=DatasetResponse, status_code=201)
async def create_dataset(
    body: DatasetCreate,
    db=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DatasetResponse:
    repo = DatasetRepository(db, current_user.id)
    d = await repo.create(
        job_id=body.job_id,
        name=body.name,
        sql=body.sql,
        description=body.description,
    )
    return DatasetResponse(
        id=d.id,
        job_id=d.job_id,
        name=d.name,
        description=d.description,
        sql=d.sql,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
    )


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: str,
    db=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DatasetResponse:
    repo = DatasetRepository(db, current_user.id)
    d = await repo.get(dataset_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return DatasetResponse(
        id=d.id,
        job_id=d.job_id,
        name=d.name,
        description=d.description,
        sql=d.sql,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
    )


@router.patch("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(
    dataset_id: str,
    body: DatasetUpdate,
    db=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DatasetResponse:
    repo = DatasetRepository(db, current_user.id)
    updates = body.model_dump(exclude_none=True)
    d = await repo.update(dataset_id, **updates)
    if d is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # If SQL changed, invalidate Redis snapshots for all charts of this dataset
    if "sql" in updates:
        chart_repo = ChartRepository(db, current_user.id)
        charts = await chart_repo.list(dataset_id=dataset_id)
        if charts:
            await snapshot_cache.delete([c.id for c in charts])
            logger.info(
                "Invalidated %d Redis snapshot(s) for dataset %s (SQL changed)",
                len(charts),
                dataset_id,
            )

    return DatasetResponse(
        id=d.id,
        job_id=d.job_id,
        name=d.name,
        description=d.description,
        sql=d.sql,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
    )


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(
    dataset_id: str,
    db=Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    repo = DatasetRepository(db, current_user.id)
    deleted = await repo.delete(dataset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Dataset not found")


@router.get("/{dataset_id}/data", response_model=DatasetDataResponse)
async def get_dataset_data(
    dataset_id: str,
    refresh: bool = False,
    db=Depends(get_db),
    job_repo: JobRepository = Depends(get_job_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> DatasetDataResponse:
    """Return dataset row data.

    Reads from the Redis snapshot of the first linked chart unless
    ?refresh=true is passed, in which case SQL is executed live via DuckDB.
    """
    repo = DatasetRepository(db, current_user.id)
    dataset = await repo.get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # ── Redis snapshot fast-path ──────────────────────────────────────────────
    if not refresh:
        chart_repo = ChartRepository(db, current_user.id)
        charts = await chart_repo.list(dataset_id=dataset_id)
        if charts:
            snap = await snapshot_cache.get(charts[0].id)
            if snap:
                return DatasetDataResponse(
                    columns=snap["columns"],
                    rows=snap["rows"],
                    row_count=snap["row_count"],
                    execution_time_ms=0,
                    error=None,
                )
    # ── Live DuckDB execution ─────────────────────────────────────────────────

    cfg: SourceConfig | None = source_config_cache.get(dataset.job_id, tenant_id=current_user.id)
    if cfg is None:
        raw = await job_repo.get_source_config(dataset.job_id)
        if raw:
            try:
                cfg = SourceConfig(**raw)
                source_config_cache.store(dataset.job_id, cfg, tenant_id=current_user.id)
            except Exception as exc:
                logger.warning(
                    "Could not reconstruct SourceConfig for job %s: %s",
                    dataset.job_id,
                    exc,
                )

    if cfg is None:
        return DatasetDataResponse(
            columns=[],
            rows=[],
            row_count=0,
            execution_time_ms=0,
            error=(
                "No connection credentials found for this database. Try re-connecting the database."
            ),
        )

    loop = asyncio.get_running_loop()
    start = time.monotonic()

    def _run() -> tuple[list[dict], str | None]:
        import time as _time

        last_error: Exception | None = None
        for attempt in range(2):  # retry once on transient connection/SSL errors
            try:
                with QueryEngine() as engine:
                    engine.attach(cfg)
                    rows = engine.execute_unlimited(dataset.sql)
                return rows, None
            except Exception as exc:
                last_error = exc
                err_lower = str(exc).lower()
                is_connection_error = any(
                    k in err_lower
                    for k in (
                        "ssl",
                        "connection",
                        "closed unexpectedly",
                        "broken pipe",
                        "timed out",
                        "eof occurred",
                        "failed to execute query",
                        "network error",
                        "server closed",
                        "could not connect",
                        "unable to connect",
                        "could not translate",
                        "nodename nor servname",
                        "name or service not known",
                        "temporary failure in name resolution",
                    )
                )
                if is_connection_error and attempt == 0:
                    logger.warning(
                        "Dataset query failed on connection error (attempt 1), retrying in 1s: %s",
                        exc,
                    )
                    _time.sleep(1)  # brief pause so PgBouncer can recover
                    continue
                break  # do not retry SQL/logic errors
        return [], str(last_error)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        rows, error = await loop.run_in_executor(pool, _run)

    elapsed_ms = int((time.monotonic() - start) * 1000)

    if error:
        return DatasetDataResponse(
            columns=[],
            rows=[],
            row_count=0,
            execution_time_ms=elapsed_ms,
            error=error,
        )

    columns = list(rows[0].keys()) if rows else []
    return DatasetDataResponse(
        columns=columns,
        rows=rows,
        row_count=len(rows),
        execution_time_ms=elapsed_ms,
        error=None,
    )
