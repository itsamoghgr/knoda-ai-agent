"""Meetings router — schedule & manage Google Meet presentation bots.

Endpoints:
  POST   /meetings                       → schedule a new meeting presentation
  GET    /meetings                       → list meetings for the current user
  GET    /meetings/{id}                  → get a single meeting
  PUT    /meetings/{id}                  → reschedule / edit a scheduled meeting
  DELETE /meetings/{id}                  → cancel a scheduled meeting
  POST   /meetings/webhook/transcript    → Recall.ai real-time transcript webhook
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from api.dependencies import CurrentUser, get_current_user
from config import settings
from meeting.scheduler import cancel_meeting_job, schedule_meeting_job
from storage.database import AsyncSessionFactory
from storage.repositories.meeting_repo import MeetingPresentationRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/meetings", tags=["meetings"])


# ── Schemas ────────────────────────────────────────────────────────────────────


class MeetingScheduleRequest(BaseModel):
    meet_url: str = Field(..., description="Full Google Meet URL (https://meet.google.com/...)")
    dashboard_id: str = Field(..., description="UUID of the dashboard to present")
    scheduled_at: datetime = Field(..., description="When to join — must be in the future (timezone-aware ISO 8601)")

    @field_validator("meet_url")
    @classmethod
    def validate_meet_url(cls, v: str) -> str:
        if not v.startswith("https://meet.google.com/"):
            raise ValueError("meet_url must be a valid Google Meet URL (https://meet.google.com/...)")
        return v

    @field_validator("scheduled_at")
    @classmethod
    def must_be_future(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("scheduled_at must be timezone-aware (include UTC offset or Z)")
        if v <= datetime.now(tz=timezone.utc):
            raise ValueError("scheduled_at must be in the future")
        return v


class MeetingResponse(BaseModel):
    id: str
    dashboard_id: str | None
    meet_url: str
    scheduled_at: datetime
    status: str
    recall_bot_id: str | None = None
    error_message: str | None = None
    created_at: datetime


def _to_response(orm) -> MeetingResponse:
    return MeetingResponse(
        id=orm.id,
        dashboard_id=orm.dashboard_id,
        meet_url=orm.meet_url,
        scheduled_at=orm.scheduled_at,
        status=orm.status,
        recall_bot_id=orm.recall_bot_id,
        error_message=orm.error_message,
        created_at=orm.created_at,
    )


# ── CRUD endpoints ─────────────────────────────────────────────────────────────


@router.post("", status_code=201)
async def schedule_meeting(
    body: MeetingScheduleRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> MeetingResponse:
    """Schedule the AI bot to join a Google Meet and present a dashboard."""
    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, current_user.id)

        # Verify the dashboard belongs to this tenant
        from storage.repositories.charts_repo import DashboardRepository
        dashboard = await DashboardRepository(db, current_user.id).get(body.dashboard_id)
        if dashboard is None:
            raise HTTPException(status_code=404, detail="Dashboard not found")

        orm = await repo.create(
            dashboard_id=body.dashboard_id,
            meet_url=body.meet_url,
            scheduled_at=body.scheduled_at,
        )

    await schedule_meeting_job(
        meeting_id=orm.id,
        meet_url=body.meet_url,
        dashboard_id=body.dashboard_id,
        tenant_id=current_user.id,
        scheduled_at=body.scheduled_at,
    )

    logger.info(
        "Scheduled meeting %s for tenant %s at %s",
        orm.id[:8],
        current_user.id[:8],
        body.scheduled_at.isoformat(),
    )
    return _to_response(orm)


@router.get("")
async def list_meetings(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[MeetingResponse]:
    """List all scheduled/past meetings for the current user."""
    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, current_user.id)
        meetings = await repo.list()
    return [_to_response(m) for m in meetings]


@router.get("/{meeting_id}")
async def get_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> MeetingResponse:
    """Get a single meeting by ID."""
    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, current_user.id)
        orm = await repo.get(meeting_id)
    if orm is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return _to_response(orm)


class MeetingUpdateRequest(BaseModel):
    meet_url: str | None = Field(None, description="New Google Meet URL")
    dashboard_id: str | None = Field(None, description="New dashboard UUID")
    scheduled_at: datetime | None = Field(None, description="New scheduled time (timezone-aware ISO 8601)")

    @field_validator("meet_url")
    @classmethod
    def validate_meet_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith("https://meet.google.com/"):
            raise ValueError("meet_url must be a valid Google Meet URL (https://meet.google.com/...)")
        return v

    @field_validator("scheduled_at")
    @classmethod
    def must_be_future(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return v
        if v.tzinfo is None:
            raise ValueError("scheduled_at must be timezone-aware")
        if v <= datetime.now(tz=timezone.utc):
            raise ValueError("scheduled_at must be in the future")
        return v


@router.put("/{meeting_id}")
async def update_meeting(
    meeting_id: str,
    body: MeetingUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> MeetingResponse:
    """Reschedule or edit a scheduled meeting. Only works on meetings with status 'scheduled'."""
    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, current_user.id)
        orm = await repo.get(meeting_id)
        if orm is None:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if orm.status != "scheduled":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot edit a meeting with status '{orm.status}'",
            )
        orm = await repo.update(
            meeting_id,
            meet_url=body.meet_url,
            dashboard_id=body.dashboard_id,
            scheduled_at=body.scheduled_at,
        )

    # Reschedule APScheduler job if time changed
    if body.scheduled_at is not None:
        try:
            cancel_meeting_job(meeting_id)
        except Exception:
            pass
        await schedule_meeting_job(
            meeting_id=meeting_id,
            meet_url=orm.meet_url,
            dashboard_id=orm.dashboard_id,
            tenant_id=current_user.id,
            scheduled_at=orm.scheduled_at,
        )
        logger.info("Rescheduled meeting %s to %s", meeting_id[:8], orm.scheduled_at.isoformat())

    return _to_response(orm)


@router.delete("/{meeting_id}")
async def cancel_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Cancel a scheduled meeting. No-op if already running or completed."""
    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, current_user.id)
        orm = await repo.get(meeting_id)
        if orm is None:
            raise HTTPException(status_code=404, detail="Meeting not found")
        if orm.status not in ("scheduled",):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot cancel a meeting with status '{orm.status}'",
            )
        await repo.cancel(meeting_id)

    # Remove from APScheduler (best-effort — job may have already fired)
    try:
        cancel_meeting_job(meeting_id)
    except Exception as exc:
        logger.warning("Could not remove APScheduler job for meeting %s: %s", meeting_id, exc)

    return {"cancelled": meeting_id}


@router.delete("/{meeting_id}/delete")
async def delete_meeting(
    meeting_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Hard-delete a meeting record regardless of status (completed, failed, cancelled, etc.)."""
    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, current_user.id)
        orm = await repo.get(meeting_id)
        if orm is None:
            raise HTTPException(status_code=404, detail="Meeting not found")
        await repo.delete(meeting_id)

    # Best-effort: remove any lingering APScheduler job
    try:
        cancel_meeting_job(meeting_id)
    except Exception:
        pass

    return {"deleted": meeting_id}


# ── Recall.ai Webhook ──────────────────────────────────────────────────────────


class TranscriptWebhookPayload(BaseModel):
    bot_id: str
    transcript: dict = Field(default_factory=dict)


@router.post("/webhook/transcript")
async def transcript_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    """Receive real-time transcript events from Recall.ai.

    Verifies Svix webhook signature, then routes attendee questions to the
    Communication Agent and plays TTS audio back into the meeting.

    This endpoint must respond quickly (< 5s) — all processing is offloaded
    to a background task so Recall.ai doesn't time out and retry.
    """
    import base64

    body_bytes = await request.body()

    # Verify Recall.ai webhook signature (Svix format)
    if settings.recall_webhook_secret:
        webhook_id = request.headers.get("webhook-id", "")
        webhook_timestamp = request.headers.get("webhook-timestamp", "")
        webhook_signature = request.headers.get("webhook-signature", "")

        if not webhook_id or not webhook_timestamp or not webhook_signature:
            raise HTTPException(status_code=401, detail="Missing webhook signature headers")

        # Decode the whsec_ secret (base64-encoded suffix after "whsec_")
        secret_b64 = settings.recall_webhook_secret.removeprefix("whsec_")
        secret_bytes = base64.b64decode(secret_b64)

        # Signed content = "{webhook-id}.{webhook-timestamp}.{raw-body}"
        signed_content = f"{webhook_id}.{webhook_timestamp}.".encode() + body_bytes

        expected_b64 = base64.b64encode(
            hmac.new(secret_bytes, signed_content, hashlib.sha256).digest()
        ).decode()

        # webhook-signature may contain multiple space-separated "v1,<base64>" signatures
        received_sigs = [s.split(",", 1)[1] for s in webhook_signature.split() if "," in s]
        if not any(hmac.compare_digest(expected_b64, sig) for sig in received_sigs):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        import json
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    bot_id = payload.get("bot_id", "")
    transcript = payload.get("transcript", {})
    text = transcript.get("text", "").strip()
    is_final = transcript.get("is_final", False)

    if not bot_id or not text or not is_final:
        # Partial transcripts or empty payloads — acknowledge and ignore
        return {"ok": True}

    # Offload to background so we respond to Recall.ai immediately
    background_tasks.add_task(_handle_transcript, bot_id, text)
    return {"ok": True}


async def _handle_transcript(bot_id: str, text: str) -> None:
    """Route attendee speech to the Communication Agent and play response audio."""
    from meeting.orchestrator import answer_and_play, get_active_session

    session = get_active_session(bot_id)
    if session is None:
        logger.debug("No active session for bot %s — ignoring transcript", bot_id)
        return

    logger.info("Bot %s — attendee said: %s", bot_id, text[:80])
    try:
        await answer_and_play(session, message=text)
    except Exception as exc:
        logger.error("Failed to answer transcript for bot %s: %s", bot_id, exc, exc_info=True)
