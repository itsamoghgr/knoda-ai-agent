"""APScheduler setup for meeting bot scheduling.

Uses AsyncIOScheduler with SQLAlchemyJobStore (PostgreSQL) so that scheduled
jobs survive server restarts.

IMPORTANT: This scheduler is designed for single-process deployments only.
Run the API server with --workers 1 when the meeting feature is enabled.
"""

from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _derive_sync_url(async_url: str) -> str:
    """Convert an asyncpg URL to a psycopg2 URL for APScheduler."""
    return (
        async_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
        .replace("postgres+asyncpg://", "postgresql+psycopg2://")
        .replace("postgresql://", "postgresql+psycopg2://")
        .replace("postgres://", "postgresql+psycopg2://")
    )


def get_scheduler() -> AsyncIOScheduler:
    if _scheduler is None:
        raise RuntimeError("Scheduler has not been started yet.")
    return _scheduler


async def start_scheduler(database_url: str) -> None:
    global _scheduler

    sync_url = _derive_sync_url(database_url)
    logger.info("Starting APScheduler with job store: %s", sync_url.split("@")[-1])

    job_store = SQLAlchemyJobStore(url=sync_url)
    _scheduler = AsyncIOScheduler(jobstores={"default": job_store})
    _scheduler.start()
    logger.info("APScheduler started — pending meeting jobs reloaded from DB")


async def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
    _scheduler = None


async def schedule_meeting_job(
    meeting_id: str,
    meet_url: str,
    dashboard_id: str,
    tenant_id: str,
    scheduled_at: datetime,
) -> str:
    """Register a one-shot job to run the meeting bot at `scheduled_at`.

    Returns the APScheduler job ID.
    """
    scheduler = get_scheduler()

    # Import here to avoid circular imports at module load time
    from meeting.orchestrator import run_meeting  # noqa: PLC0415

    job_id = f"meeting:{meeting_id}"
    scheduler.add_job(
        run_meeting,
        trigger=DateTrigger(run_date=scheduled_at),
        id=job_id,
        replace_existing=True,
        misfire_grace_time=300,  # fire up to 5 min late if server was restarting
        kwargs={
            "meeting_id": meeting_id,
            "meet_url": meet_url,
            "dashboard_id": dashboard_id,
            "tenant_id": tenant_id,
        },
    )
    logger.info("Scheduled meeting job %s for %s", job_id, scheduled_at.isoformat())
    return job_id


def cancel_meeting_job(meeting_id: str) -> None:
    """Remove the APScheduler job for a meeting (if it still exists)."""
    scheduler = get_scheduler()
    job_id = f"meeting:{meeting_id}"
    job = scheduler.get_job(job_id)
    if job:
        job.remove()
        logger.info("Cancelled meeting job %s", job_id)
