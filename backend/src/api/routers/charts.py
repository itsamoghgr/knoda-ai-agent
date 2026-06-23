"""Charts router — CRUD for saved chart visualizations."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentUser, get_current_user
from storage import snapshot_cache
from storage.database import get_db
from storage.repositories.charts_repo import ChartRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/charts", tags=["charts"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class ChartCreate(BaseModel):
    dataset_id: str
    name: str
    chart_type: str
    config: dict
    description: str = ""


class ChartUpdate(BaseModel):
    name: str | None = None
    chart_type: str | None = None
    config: dict | None = None
    description: str | None = None


class ChartResponse(BaseModel):
    id: str
    dataset_id: str
    name: str
    description: str
    chart_type: str
    config: dict
    created_at: str
    updated_at: str
    snapshot: dict | None = None  # Redis snapshot data, None on cache miss


def _to_response(c, snap: dict | None = None) -> ChartResponse:
    return ChartResponse(
        id=c.id,
        dataset_id=c.dataset_id,
        name=c.name,
        description=c.description,
        chart_type=c.chart_type,
        config=c.config or {},
        created_at=c.created_at.isoformat(),
        updated_at=c.updated_at.isoformat(),
        snapshot=snap,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ChartResponse])
async def list_charts(
    dataset_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ChartResponse]:
    repo = ChartRepository(db, current_user.id)
    items = await repo.list(dataset_id=dataset_id)
    return [_to_response(c) for c in items]


@router.post("", response_model=ChartResponse, status_code=201)
async def create_chart(
    body: ChartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChartResponse:
    repo = ChartRepository(db, current_user.id)
    c = await repo.create(
        dataset_id=body.dataset_id,
        name=body.name,
        chart_type=body.chart_type,
        config=body.config,
        description=body.description,
    )
    return _to_response(c)


@router.get("/{chart_id}", response_model=ChartResponse)
async def get_chart(
    chart_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChartResponse:
    repo = ChartRepository(db, current_user.id)
    c = await repo.get(chart_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Chart not found")
    snap = await snapshot_cache.get(chart_id)  # None on cache miss
    return _to_response(c, snap)


@router.patch("/{chart_id}", response_model=ChartResponse)
async def update_chart(
    chart_id: str,
    body: ChartUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChartResponse:
    repo = ChartRepository(db, current_user.id)
    updates = body.model_dump(exclude_none=True)
    c = await repo.update(chart_id, **updates)
    if c is None:
        raise HTTPException(status_code=404, detail="Chart not found")
    return _to_response(c)


@router.delete("/{chart_id}", status_code=204)
async def delete_chart(
    chart_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    repo = ChartRepository(db, current_user.id)
    deleted = await repo.delete(chart_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Chart not found")
    # Clean up Redis snapshot — fire and forget
    await snapshot_cache.delete([chart_id])
