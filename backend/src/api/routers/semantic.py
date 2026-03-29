"""Semantic layer router — browse, edit, and export the generated semantic layer."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentUser, get_current_user, get_semantic_repo, verify_job_ownership
from models.semantic import SemanticModel
from storage.database import get_db
from storage.repositories import SemanticRepository

router = APIRouter(tags=["semantic"])


@router.get("/jobs/{job_id}/semantic")
async def get_semantic_layer(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    semantic_repo: SemanticRepository = Depends(get_semantic_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SemanticModel]:
    """Return the full semantic layer as structured JSON."""
    await verify_job_ownership(job_id, current_user.id, db)
    models = await semantic_repo.list_models(job_id)
    if not models:
        raise HTTPException(status_code=404, detail="No semantic layer found for this job")
    return models


@router.get("/jobs/{job_id}/semantic.yaml", response_class=PlainTextResponse)
async def download_semantic_yaml(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    semantic_repo: SemanticRepository = Depends(get_semantic_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> str:
    """Download the dbt MetricFlow YAML for the semantic layer."""
    await verify_job_ownership(job_id, current_user.id, db)
    yaml_content = await semantic_repo.get_snapshot(job_id)
    if not yaml_content:
        raise HTTPException(status_code=404, detail="No YAML snapshot found for this job")
    return PlainTextResponse(
        content=yaml_content,
        media_type="application/x-yaml",
        headers={"Content-Disposition": f"attachment; filename=semantic_layer_{job_id[:8]}.yaml"},
    )


class UpdateDimensionRequest(BaseModel):
    description: str | None = None
    time_granularity: str | None = None


@router.patch("/jobs/{job_id}/semantic/dimensions/{dimension_id}")
async def update_dimension(
    job_id: str,
    dimension_id: str,
    request: UpdateDimensionRequest,
    db: AsyncSession = Depends(get_db),
    _semantic_repo: SemanticRepository = Depends(get_semantic_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Update a single dimension's description or time granularity.
    Allows corrections without re-running the full discovery.
    """
    from sqlalchemy import select

    from storage.orm.semantic import DimensionORM, SemanticModelORM

    await verify_job_ownership(job_id, current_user.id, db)

    result = await db.execute(
        select(DimensionORM)
        .join(SemanticModelORM, DimensionORM.model_id == SemanticModelORM.id)
        .where(DimensionORM.id == dimension_id, SemanticModelORM.job_id == job_id)
    )
    dim = result.scalar_one_or_none()
    if not dim:
        raise HTTPException(status_code=404, detail="Dimension not found")
    if request.description is not None:
        dim.description = request.description
    if request.time_granularity is not None:
        dim.time_granularity = request.time_granularity
    await db.commit()

    return {"status": "updated", "id": dimension_id}
