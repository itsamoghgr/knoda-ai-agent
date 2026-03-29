import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from storage.database import Base


class MeetingPresentationORM(Base):
    __tablename__ = "meeting_presentations"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    dashboard_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("dashboards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    meet_url: Mapped[str] = mapped_column(sa.Text, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, index=True
    )
    # scheduled | running | completed | failed | cancelled
    status: Mapped[str] = mapped_column(
        sa.String(32), nullable=False, default="scheduled", index=True
    )
    recall_bot_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    present_session_id: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
