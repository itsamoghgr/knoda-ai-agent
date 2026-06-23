from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import select

from storage.orm.meeting import MeetingPresentationORM

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class MeetingPresentationRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def create(
        self,
        dashboard_id: str | None,
        meet_url: str,
        scheduled_at: datetime,
    ) -> MeetingPresentationORM:
        orm = MeetingPresentationORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            dashboard_id=dashboard_id,
            meet_url=meet_url,
            scheduled_at=scheduled_at,
            status="scheduled",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def get(self, meeting_id: str) -> MeetingPresentationORM | None:
        result = await self._db.execute(
            select(MeetingPresentationORM).where(
                MeetingPresentationORM.id == meeting_id,
                MeetingPresentationORM.tenant_id == self._tenant_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_bot_id(self, recall_bot_id: str) -> MeetingPresentationORM | None:
        """Lookup by Recall.ai bot ID — used in webhook handler (no tenant filter)."""
        result = await self._db.execute(
            select(MeetingPresentationORM).where(
                MeetingPresentationORM.recall_bot_id == recall_bot_id,
            )
        )
        return result.scalar_one_or_none()

    async def list(self) -> list[MeetingPresentationORM]:
        result = await self._db.execute(
            select(MeetingPresentationORM)
            .where(MeetingPresentationORM.tenant_id == self._tenant_id)
            .order_by(MeetingPresentationORM.scheduled_at.desc())
        )
        return list(result.scalars().all())

    async def update_status(
        self,
        meeting_id: str,
        status: str,
        *,
        recall_bot_id: str | None = None,
        present_session_id: str | None = None,
        error_message: str | None = None,
    ) -> MeetingPresentationORM | None:
        result = await self._db.execute(
            select(MeetingPresentationORM).where(
                MeetingPresentationORM.id == meeting_id,
            )
        )
        orm = result.scalar_one_or_none()
        if not orm:
            return None
        orm.status = status
        orm.updated_at = datetime.utcnow()
        if recall_bot_id is not None:
            orm.recall_bot_id = recall_bot_id
        if present_session_id is not None:
            orm.present_session_id = present_session_id
        if error_message is not None:
            orm.error_message = error_message
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def update(
        self,
        meeting_id: str,
        *,
        meet_url: str | None = None,
        dashboard_id: str | None = None,
        scheduled_at: datetime | None = None,
    ) -> MeetingPresentationORM | None:
        """Update mutable fields on a scheduled meeting."""
        orm = await self.get(meeting_id)
        if not orm:
            return None
        if meet_url is not None:
            orm.meet_url = meet_url
        if dashboard_id is not None:
            orm.dashboard_id = dashboard_id
        if scheduled_at is not None:
            orm.scheduled_at = scheduled_at
        orm.updated_at = datetime.utcnow()
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def cancel(self, meeting_id: str) -> MeetingPresentationORM | None:
        orm = await self.get(meeting_id)
        if not orm:
            return None
        orm.status = "cancelled"
        orm.updated_at = datetime.utcnow()
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def delete(self, meeting_id: str) -> None:
        orm = await self.get(meeting_id)
        if not orm:
            return
        await self._db.delete(orm)
        await self._db.commit()

    async def mark_orphaned_running_as_failed(self) -> int:
        """On startup, mark any meetings stuck in 'running' as 'failed'.

        These are orphans left over from a previous server process that crashed
        or was restarted while a meeting was active.
        Returns the number of rows updated.
        """
        from sqlalchemy import update as sa_update

        result = await self._db.execute(
            sa_update(MeetingPresentationORM)
            .where(MeetingPresentationORM.status == "running")
            .values(
                status="failed",
                error_message="Server restarted while meeting was running",
                updated_at=datetime.utcnow(),
            )
        )
        await self._db.commit()
        return result.rowcount
