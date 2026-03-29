"""Add meeting_presentations table for Google Meet bot scheduling.

Revision ID: 0009_meeting_presentations
Revises: 0008_v2_memory
Create Date: 2026-03-28
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0009_meeting_presentations"
down_revision = "0008_v2_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meeting_presentations",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=False), nullable=False),
        sa.Column(
            "dashboard_id",
            UUID(as_uuid=False),
            sa.ForeignKey("dashboards.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("meet_url", sa.Text, nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status", sa.String(32), nullable=False, server_default="scheduled"
        ),
        sa.Column("recall_bot_id", sa.Text, nullable=True),
        sa.Column("present_session_id", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_meeting_presentations_tenant_id",
        "meeting_presentations",
        ["tenant_id"],
    )
    op.create_index(
        "ix_meeting_presentations_scheduled_at",
        "meeting_presentations",
        ["scheduled_at"],
    )
    op.create_index(
        "ix_meeting_presentations_status",
        "meeting_presentations",
        ["status"],
    )
    op.create_index(
        "ix_meeting_presentations_dashboard_id",
        "meeting_presentations",
        ["dashboard_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_meeting_presentations_dashboard_id", "meeting_presentations")
    op.drop_index("ix_meeting_presentations_status", "meeting_presentations")
    op.drop_index("ix_meeting_presentations_scheduled_at", "meeting_presentations")
    op.drop_index("ix_meeting_presentations_tenant_id", "meeting_presentations")
    op.drop_table("meeting_presentations")
