"""Dashboards router — CRUD, layout, and snapshot-backed data delivery.

Dashboard opens read from Redis (zero DuckDB). The /refresh endpoint
re-executes all chart SQLs in parallel and updates Redis snapshots.
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentUser, get_current_user
from storage import snapshot_cache
from storage.database import get_db
from storage.repositories.charts_repo import DashboardRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboards", tags=["dashboards"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class DashboardCreate(BaseModel):
    name: str
    description: str = ""


class DashboardUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ChartSnapshotData(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int
    cached_at: str | None
    error: str | None = None


class DashboardChartItem(BaseModel):
    id: str
    chart_id: str
    grid_x: int
    grid_y: int
    grid_w: int
    grid_h: int
    chart_name: str
    chart_type: str
    dataset_id: str
    config: dict
    snapshot: ChartSnapshotData | None = None  # None = no cached data


class DashboardResponse(BaseModel):
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str


class DashboardDetailResponse(DashboardResponse):
    charts: list[DashboardChartItem]


class AddChartRequest(BaseModel):
    chart_id: str
    grid_x: int = 0
    grid_y: int = 0
    grid_w: int = 6
    grid_h: int = 4


class LayoutItem(BaseModel):
    chart_id: str
    grid_x: int
    grid_y: int
    grid_w: int
    grid_h: int


class UpdateLayoutRequest(BaseModel):
    layout: list[LayoutItem]


def _to_response(d) -> DashboardResponse:
    return DashboardResponse(
        id=d.id,
        name=d.name,
        description=d.description,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
    )


def _snap_to_model(raw: dict | None) -> ChartSnapshotData | None:
    if raw is None:
        return None
    return ChartSnapshotData(
        columns=raw.get("columns", []),
        rows=raw.get("rows", []),
        row_count=raw.get("row_count", 0),
        cached_at=raw.get("cached_at"),
        error=raw.get("error"),
    )


async def _auto_populate_missing(
    missing_chart_ids: list[str],
    dashboard_charts: list,
    snapshots: dict[str, dict],
    db: AsyncSession,
    tenant_id: str,
) -> dict[str, dict]:
    """For charts with no snapshot: execute SQL via DuckDB in parallel, write to Redis.

    Only called when there are cache misses. Returns the updated snapshots dict.
    """
    from datetime import datetime

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from models.connection import SourceConfig
    from query_engine.engine import run_queries_parallel
    from storage import source_config_cache
    from storage.orm.charts import ChartORM

    missing_set = set(missing_chart_ids)

    # ── 1. Load missing charts with their dataset + job info ───────────────────
    result = await db.execute(
        select(ChartORM)
        .where(ChartORM.id.in_(missing_set), ChartORM.tenant_id == tenant_id)
        .options(selectinload(ChartORM.dataset))
    )
    charts_with_data = result.scalars().all()

    # ── 2. Build (SourceConfig, sql) pairs ────────────────────────────────────
    from storage.repositories import JobRepository

    job_repo = JobRepository(db, tenant_id)
    cfg_cache: dict[str, SourceConfig | None] = {}

    valid: list[tuple] = []  # (chart_id, cfg, sql)
    for chart in charts_with_data:
        if not chart.dataset:
            continue
        job_id = chart.dataset.job_id

        # Try in-memory cache first, then fall back to DB
        if job_id in cfg_cache:
            cfg = cfg_cache[job_id]
        else:
            cfg = source_config_cache.get(job_id, tenant_id=tenant_id)
            if cfg is None:
                raw = await job_repo.get_source_config(job_id)
                if raw:
                    try:
                        cfg = SourceConfig(**raw)
                        source_config_cache.store(job_id, cfg, tenant_id=tenant_id)
                    except Exception:
                        cfg = None
            cfg_cache[job_id] = cfg

        if cfg is None:
            logger.debug(
                "auto_populate: no SourceConfig for job %s, skipping chart %s",
                job_id,
                chart.id,
            )
            continue
        valid.append((chart.id, cfg, chart.dataset.sql))

    if not valid:
        return snapshots  # nothing we can execute — return as-is

    # ── 3. Run queries in parallel ─────────────────────────────────────────────
    pairs = [(cfg, sql) for _, cfg, sql in valid]
    results = await run_queries_parallel(pairs, max_workers=min(len(pairs), 6))

    # ── 4. Write to Redis + merge into snapshots ───────────────────────────────
    cached_at = datetime.now(UTC).isoformat()
    updated = dict(snapshots)
    for (chart_id, _, _), res in zip(valid, results, strict=False):
        await snapshot_cache.set(chart_id, res["columns"], res["rows"], cached_at=cached_at)
        updated[chart_id] = {
            "columns": res["columns"],
            "rows": res["rows"],
            "row_count": len(res["rows"]),
            "cached_at": cached_at,
            "error": res.get("error"),
        }
        logger.info("auto_populate: cached %d rows for chart %s", len(res["rows"]), chart_id)

    return updated


_AUTO_POPULATE_TIMEOUT = 15  # seconds — enough for most queries, prevents infinite hangs


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DashboardResponse])
async def list_dashboards(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[DashboardResponse]:
    repo = DashboardRepository(db, current_user.id)
    items = await repo.list()
    return [_to_response(d) for d in items]


@router.post("", response_model=DashboardResponse, status_code=201)
async def create_dashboard(
    body: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DashboardResponse:
    repo = DashboardRepository(db, current_user.id)
    d = await repo.create(name=body.name, description=body.description)
    return _to_response(d)


@router.get("/{dashboard_id}", response_model=DashboardDetailResponse)
async def get_dashboard(
    dashboard_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DashboardDetailResponse:
    """Return dashboard metadata + all chart snapshots.

    Fast path (all cached):  1 PG query + 1 Redis MGET = ~5ms
    Slow path (cache miss):  runs queries inline with a timeout; returns data
                             directly even when Redis writes fail.
    """
    import asyncio

    repo = DashboardRepository(db, current_user.id)
    d = await repo.get_with_charts(dashboard_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    chart_ids = [dc.chart_id for dc in d.dashboard_charts]
    snapshots = await snapshot_cache.get_many(chart_ids)  # single Redis MGET

    # ── Auto-populate missing charts (inline with timeout) ────────────────────
    missing = [cid for cid in chart_ids if cid not in snapshots]
    if missing:
        logger.info(
            "Dashboard %s: %d/%d charts missing snapshots, auto-populating inline",
            dashboard_id[:8],
            len(missing),
            len(chart_ids),
        )
        try:
            snapshots = await asyncio.wait_for(
                _auto_populate_missing(missing, d.dashboard_charts, snapshots, db, current_user.id),
                timeout=_AUTO_POPULATE_TIMEOUT,
            )
        except TimeoutError:
            logger.warning(
                "Dashboard %s: auto-populate timed out after %ds, returning partial data",
                dashboard_id[:8],
                _AUTO_POPULATE_TIMEOUT,
            )
        except Exception as exc:
            logger.warning("Dashboard %s: auto-populate failed: %s", dashboard_id[:8], exc)
    # ─────────────────────────────────────────────────────────────────────────────

    charts = [
        DashboardChartItem(
            id=dc.id,
            chart_id=dc.chart_id,
            grid_x=dc.grid_x,
            grid_y=dc.grid_y,
            grid_w=dc.grid_w,
            grid_h=dc.grid_h,
            chart_name=dc.chart.name if dc.chart else "",
            chart_type=dc.chart.chart_type if dc.chart else "",
            dataset_id=dc.chart.dataset_id if dc.chart else "",
            config=dc.chart.config if dc.chart else {},
            snapshot=_snap_to_model(snapshots.get(dc.chart_id)),
        )
        for dc in d.dashboard_charts
    ]

    return DashboardDetailResponse(
        id=d.id,
        name=d.name,
        description=d.description,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
        charts=charts,
    )


@router.post("/{dashboard_id}/refresh", response_model=DashboardDetailResponse)
async def refresh_dashboard(
    dashboard_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DashboardDetailResponse:
    """Re-execute all chart SQLs in parallel, update Redis, return fresh data.

    All charts run simultaneously — total time ≈ slowest single chart.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from models.connection import SourceConfig
    from query_engine.engine import run_queries_parallel
    from storage import source_config_cache
    from storage.orm.charts import ChartORM, DashboardChartORM, DashboardORM
    from storage.repositories import JobRepository

    # ── 1. Load dashboard + charts (with dataset SQL) ─────────────────────────
    result = await db.execute(
        select(DashboardORM)
        .where(
            DashboardORM.id == dashboard_id,
            DashboardORM.tenant_id == current_user.id,
        )
        .options(
            selectinload(DashboardORM.dashboard_charts)
            .selectinload(DashboardChartORM.chart)
            .selectinload(ChartORM.dataset)
        )
    )
    d = result.scalar_one_or_none()
    if d is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    # ── 2. Build (SourceConfig, sql) pairs per chart ──────────────────────────
    job_repo = JobRepository(db, current_user.id)
    cfg_cache: dict[str, SourceConfig | None] = {}

    async def _resolve_cfg(job_id: str) -> SourceConfig | None:
        if job_id in cfg_cache:
            return cfg_cache[job_id]
        cfg = source_config_cache.get(job_id, tenant_id=current_user.id)
        if cfg is None:
            raw = await job_repo.get_source_config(job_id)
            if raw:
                try:
                    cfg = SourceConfig(**raw)
                    source_config_cache.store(job_id, cfg, tenant_id=current_user.id)
                except Exception as exc:
                    logger.warning(
                        "refresh: could not reconstruct SourceConfig for job %s: %s", job_id, exc
                    )
        cfg_cache[job_id] = cfg
        return cfg

    valid_charts = []  # (dc, cfg, sql)
    for dc in d.dashboard_charts:
        if not dc.chart or not dc.chart.dataset:
            continue
        cfg = await _resolve_cfg(dc.chart.dataset.job_id)
        if cfg:
            valid_charts.append((dc, cfg, dc.chart.dataset.sql))

    # ── 3. Run all queries in parallel ────────────────────────────────────────
    # Build an in-memory snapshots dict so we don't need Redis to return data
    snapshots: dict[str, dict] = {}
    cached_at = datetime.now(UTC).isoformat()

    if valid_charts:
        queries = [(cfg, sql) for _, cfg, sql in valid_charts]
        results = await run_queries_parallel(queries, max_workers=min(len(queries), 6))

        # ── 4. Build snapshots in-memory + best-effort Redis write ─────────
        for (dc, _, _), res in zip(valid_charts, results, strict=False):
            snap = {
                "columns": res["columns"],
                "rows": res["rows"],
                "row_count": len(res["rows"]),
                "cached_at": cached_at,
            }
            snapshots[dc.chart_id] = snap
            # Best-effort write to Redis (fails silently when Redis is down)
            await snapshot_cache.set(
                dc.chart_id,
                res["columns"],
                res["rows"],
                cached_at=cached_at,
            )

    # ── 5. Return full dashboard with fresh snapshot data ─────────────────────
    charts = [
        DashboardChartItem(
            id=dc.id,
            chart_id=dc.chart_id,
            grid_x=dc.grid_x,
            grid_y=dc.grid_y,
            grid_w=dc.grid_w,
            grid_h=dc.grid_h,
            chart_name=dc.chart.name if dc.chart else "",
            chart_type=dc.chart.chart_type if dc.chart else "",
            dataset_id=dc.chart.dataset_id if dc.chart else "",
            config=dc.chart.config if dc.chart else {},
            snapshot=_snap_to_model(snapshots.get(dc.chart_id)),
        )
        for dc in d.dashboard_charts
    ]

    return DashboardDetailResponse(
        id=d.id,
        name=d.name,
        description=d.description,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
        charts=charts,
    )


@router.patch("/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(
    dashboard_id: str,
    body: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> DashboardResponse:
    repo = DashboardRepository(db, current_user.id)
    updates = body.model_dump(exclude_none=True)
    d = await repo.update(dashboard_id, **updates)
    if d is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return _to_response(d)


@router.delete("/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    repo = DashboardRepository(db, current_user.id)
    deleted = await repo.delete(dashboard_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Dashboard not found")


@router.post("/{dashboard_id}/charts", status_code=201)
async def add_chart_to_dashboard(
    dashboard_id: str,
    body: AddChartRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    repo = DashboardRepository(db, current_user.id)
    d = await repo.get(dashboard_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    dc = await repo.add_chart(
        dashboard_id=dashboard_id,
        chart_id=body.chart_id,
        grid_x=body.grid_x,
        grid_y=body.grid_y,
        grid_w=body.grid_w,
        grid_h=body.grid_h,
    )
    return {
        "id": dc.id,
        "dashboard_id": dc.dashboard_id,
        "chart_id": dc.chart_id,
        "grid_x": dc.grid_x,
        "grid_y": dc.grid_y,
        "grid_w": dc.grid_w,
        "grid_h": dc.grid_h,
    }


@router.delete("/{dashboard_id}/charts/{chart_id}", status_code=204)
async def remove_chart_from_dashboard(
    dashboard_id: str,
    chart_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    repo = DashboardRepository(db, current_user.id)
    removed = await repo.remove_chart(dashboard_id, chart_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Chart not found in dashboard")


@router.patch("/{dashboard_id}/layout", status_code=200)
async def update_dashboard_layout(
    dashboard_id: str,
    body: UpdateLayoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    repo = DashboardRepository(db, current_user.id)
    d = await repo.get(dashboard_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    await repo.update_layout(
        dashboard_id,
        [item.model_dump() for item in body.layout],
    )
    return {"status": "ok"}
