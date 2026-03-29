"""Catalog router — browse discovered schema trees, profiles, and relationships."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    CurrentUser,
    get_current_user,
    get_profile_repo,
    get_relationship_repo,
    get_schema_repo,
    verify_job_ownership,
)
from models.profile import ProfileResult
from models.relationship import Relationship
from models.schema import TableMeta
from storage.database import get_db
from storage.repositories import (
    ProfileRepository,
    RelationshipRepository,
    SchemaRepository,
)

router = APIRouter(tags=["catalog"])


@router.get("/jobs/{job_id}/catalog")
async def get_catalog(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    schema_repo: SchemaRepository = Depends(get_schema_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[TableMeta]:
    """Return the full discovered schema tree for a job."""
    await verify_job_ownership(job_id, current_user.id, db)
    tables = await schema_repo.list_tables(job_id)
    if not tables:
        raise HTTPException(status_code=404, detail="No schema data found for this job")
    return tables


@router.get("/jobs/{job_id}/profiles")
async def get_profiles(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    profile_repo: ProfileRepository = Depends(get_profile_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ProfileResult]:
    """Return column-level data profiles for all tables in a job."""
    await verify_job_ownership(job_id, current_user.id, db)
    profiles = await profile_repo.get_profiles(job_id)
    if not profiles:
        raise HTTPException(status_code=404, detail="No profile data found for this job")
    return profiles


@router.get("/jobs/{job_id}/relationships")
async def get_relationships(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    rel_repo: RelationshipRepository = Depends(get_relationship_repo),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Relationship]:
    """Return the detected FK relationship graph for a job."""
    await verify_job_ownership(job_id, current_user.id, db)
    return await rel_repo.list_by_job(job_id)
