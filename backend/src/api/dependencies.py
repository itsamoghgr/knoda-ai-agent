"""FastAPI dependency providers — injected into route handlers via Depends()."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase._async.client import AsyncClient
from supabase._async.client import create_client as _create_supabase

from config import settings
from storage.database import get_db
from storage.repositories import (
    JobRepository,
    ProfileRepository,
    RelationshipRepository,
    SchemaRepository,
    SemanticRepository,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlalchemy.ext.asyncio import AsyncSession

# ── Auth ──────────────────────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)

# Lazily initialised Supabase async client — created once per process.
_supabase: AsyncClient | None = None
_supabase_lock = asyncio.Lock()


async def _get_supabase() -> AsyncClient:
    global _supabase
    if _supabase is not None:
        return _supabase
    async with _supabase_lock:
        if _supabase is None:
            _supabase = await _create_supabase(
                settings.supabase_url,
                settings.supabase_service_role_key,
            )
    return _supabase


@dataclass
class CurrentUser:
    """Authenticated caller extracted from the Supabase JWT."""

    id: str  # UUID string — used as tenant_id for all DB queries


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    """Verify the Supabase JWT via supabase.auth.get_user() and return the caller.

    Bot bypass: if X-Bot-Session header is present and matches a valid Redis
    presentation session, return that session's tenant_id without Supabase auth.
    This lets the screenshare Playwright browser authenticate API calls using
    only the active meeting session — no user JWT needed.
    """
    # ── Bot session bypass ────────────────────────────────────────────────────
    bot_session_id = request.headers.get("x-bot-session")
    if bot_session_id:
        try:
            import json as _json

            from storage.redis_client import get_redis

            # Scan all tenant-scoped keys for this session_id
            redis = get_redis()
            pattern = f"present_session:*:{bot_session_id}"
            async for key in redis.scan_iter(pattern, count=10):
                raw = await redis.get(key)
                if raw:
                    data = _json.loads(raw)
                    tenant_id = data.get("tenant_id", "")
                    if tenant_id:
                        return CurrentUser(id=tenant_id)
        except Exception:
            pass  # Fall through to normal auth if Redis lookup fails

    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        supabase = await _get_supabase()
        response = await supabase.auth.get_user(credentials.credentials)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    if response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(id=str(response.user.id))


async def verify_job_ownership(
    job_id: str,
    tenant_id: str,
    db: AsyncSession,
) -> None:
    """Raise 403 if job_id does not belong to this tenant.

    Uses JobRepository.get() which already filters by tenant_id — returns None
    for both non-existent jobs and jobs belonging to other tenants.
    Always raises 403 (not 404) to avoid leaking whether a job exists at all.
    """
    job = await JobRepository(db, tenant_id).get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Job not found or access denied",
        )


# ── Repository providers ──────────────────────────────────────────────────────


async def get_job_repo(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> AsyncGenerator[JobRepository, None]:
    yield JobRepository(db, current_user.id)


async def get_schema_repo(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[SchemaRepository, None]:
    yield SchemaRepository(db)


async def get_profile_repo(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[ProfileRepository, None]:
    yield ProfileRepository(db)


async def get_relationship_repo(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[RelationshipRepository, None]:
    yield RelationshipRepository(db)


async def get_semantic_repo(
    db: AsyncSession = Depends(get_db),
) -> AsyncGenerator[SemanticRepository, None]:
    yield SemanticRepository(db)
