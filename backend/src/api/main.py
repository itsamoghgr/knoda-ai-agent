"""FastAPI application factory and server entrypoint."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from api.rate_limit import limiter

from api.routers import agent as agent_router
from api.routers import catalog, jobs, semantic
from api.routers import conversations as conversations_router
from api.routers import settings as settings_router
from api.routers import usage as usage_router
from api.routers import sql_lab as sql_lab_router
from api.routers import datasets as datasets_router
from api.routers import charts as charts_router
from api.routers import dashboards as dashboards_router
from api.routers import present as present_router
from api.routers import meetings as meetings_router
from config import settings
from meeting.scheduler import start_scheduler, stop_scheduler
from storage.database import AsyncSessionFactory, engine
from storage.redis_client import close_redis
from storage.orm import (  # noqa: F401 — registers all ORM models with Base
    AppSettingORM,
    ChartORM,
    ColumnMetaORM,
    ColumnProfileORM,
    ConversationMessageORM,
    ConversationSessionTitleORM,
    ConversationSummaryORM,
    DashboardChartORM,
    DashboardORM,
    DatasetIntentCardORM,
    DatasetORM,
    DimensionORM,
    EntityORM,
    JobORM,
    MeasureORM,
    ProfileResultORM,
    RelationshipORM,
    SemanticModelORM,
    SemanticSnapshotORM,
    TableMetaORM,
    TokenUsageORM,
    MeetingPresentationORM,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _cleanup_orphaned_meetings() -> None:
    """Mark any meetings stuck in 'running' as 'failed' on startup."""
    from storage.repositories.meeting_repo import MeetingPresentationRepository

    async with AsyncSessionFactory() as db:
        # tenant_id is unused by mark_orphaned_running_as_failed (no tenant filter)
        repo = MeetingPresentationRepository(db, tenant_id="")
        count = await repo.mark_orphaned_running_as_failed()
        if count:
            logger.warning("Marked %d orphaned 'running' meeting(s) as 'failed' on startup", count)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting Knoda.ai API")
    await _cleanup_orphaned_meetings()
    cleanup_task = present_router.start_session_cleanup()
    db_url = settings.apscheduler_database_url or settings.database_url
    await start_scheduler(db_url)
    yield
    await stop_scheduler()
    cleanup_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await cleanup_task
    await close_redis()
    await engine.dispose()
    logger.info("Knoda.ai API stopped")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to every response."""

    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title="Knoda.ai",
        description="LLM-powered database discovery and semantic layer generation API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # Rate limiter — must be set on app.state before any request arrives
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Security headers — added first so CORS middleware wraps it (LIFO order)
    app.add_middleware(SecurityHeadersMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With", "X-Bot-Session"],
    )

    api_prefix = "/api/v1"
    app.include_router(settings_router.router, prefix=api_prefix)
    app.include_router(jobs.router, prefix=api_prefix)
    app.include_router(catalog.router, prefix=api_prefix)
    app.include_router(semantic.router, prefix=api_prefix)
    app.include_router(agent_router.router, prefix=api_prefix)
    app.include_router(usage_router.router, prefix=api_prefix)
    app.include_router(sql_lab_router.router, prefix=api_prefix)
    app.include_router(datasets_router.router, prefix=api_prefix)
    app.include_router(charts_router.router, prefix=api_prefix)
    app.include_router(dashboards_router.router, prefix=api_prefix)
    app.include_router(present_router.router, prefix=api_prefix)
    app.include_router(meetings_router.router, prefix=api_prefix)
    app.include_router(conversations_router.router, prefix=api_prefix)

    @app.get("/api/v1/health")
    async def health() -> dict:
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/api/v1/connectors")
    async def list_connectors() -> list[dict]:
        return [
            {
                "type": "postgres",
                "label": "PostgreSQL",
                "required_fields": ["host", "port", "database", "username", "password"],
            },
            {
                "type": "mysql",
                "label": "MySQL",
                "required_fields": ["host", "port", "database", "username", "password"],
            },
            {
                "type": "duckdb",
                "label": "DuckDB file",
                "required_fields": ["file_path"],
            },
            {
                "type": "s3_parquet",
                "label": "S3 / Parquet",
                "required_fields": ["s3_bucket", "s3_prefix"],
                "optional_fields": ["s3_region", "aws_access_key_id", "aws_secret_access_key"],
            },
        ]

    return app


app = create_app()
