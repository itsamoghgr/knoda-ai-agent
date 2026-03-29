"""Usage router — exposes aggregated LLM token consumption."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentUser, get_current_user
from storage.database import get_db
from storage.repositories.token_usage_repo import TokenUsageRepository

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("")
async def get_usage(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return aggregated token usage totals for the current user."""
    return await TokenUsageRepository(db, current_user.id).get_totals()


@router.get("/calls")
async def list_usage_calls(
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    """Return individual LLM call records, most recent first."""
    return await TokenUsageRepository(db, current_user.id).list_calls(limit=limit)
