"""Add v2 memory tables: dataset_intent_cards, conversation_summaries, conversation_messages.

Also adds tenant_id to the charts and datasets tables (backfill with a placeholder UUID).

Revision ID: 0008_v2_memory
Revises: 0007_multi_tenant
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0008_v2_memory"
down_revision: str | None = "0007_multi_tenant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── dataset_intent_cards ────────────────────────────────────────────────
    op.create_table(
        "dataset_intent_cards",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "tenant_id", UUID(as_uuid=False), nullable=False
        ),
        sa.Column(
            "dataset_id",
            UUID(as_uuid=False),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "chart_id",
            UUID(as_uuid=False),
            sa.ForeignKey("charts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column(
            "tables_used",
            sa.ARRAY(sa.Text),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "times_accessed", sa.Integer, nullable=False, server_default="0"
        ),
        sa.Column(
            "last_accessed", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_intent_cards_tenant_id", "dataset_intent_cards", ["tenant_id"]
    )
    op.create_index(
        "ix_intent_cards_dataset_id", "dataset_intent_cards", ["dataset_id"]
    )

    # Add vector embedding column (pgvector extension required)
    op.execute(
        "ALTER TABLE dataset_intent_cards "
        "ADD COLUMN IF NOT EXISTS embedding vector(1536)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_intent_cards_embedding "
        "ON dataset_intent_cards USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )

    # ── conversation_summaries ──────────────────────────────────────────────
    op.create_table(
        "conversation_summaries",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=False), nullable=False),
        sa.Column("session_id", sa.Text, nullable=False),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_conv_summaries_tenant_id", "conversation_summaries", ["tenant_id"]
    )
    op.create_index(
        "ix_conv_summaries_session_id", "conversation_summaries", ["session_id"]
    )

    # ── conversation_messages ───────────────────────────────────────────────
    op.create_table(
        "conversation_messages",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=False), nullable=False),
        sa.Column("session_id", sa.Text, nullable=False),
        sa.Column(
            "job_id",
            UUID(as_uuid=False),
            sa.ForeignKey("jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column(
            "channel", sa.String(32), nullable=False, server_default="chat"
        ),
        sa.Column("tool_calls", JSONB, nullable=True),
        sa.Column(
            "dataset_id",
            UUID(as_uuid=False),
            sa.ForeignKey("datasets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "chart_id",
            UUID(as_uuid=False),
            sa.ForeignKey("charts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_conv_messages_tenant_session",
        "conversation_messages",
        ["tenant_id", "session_id"],
    )
    op.create_index(
        "ix_conv_messages_tenant_time",
        "conversation_messages",
        ["tenant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("conversation_messages")
    op.drop_table("conversation_summaries")
    op.execute(
        "DROP INDEX IF EXISTS ix_intent_cards_embedding"
    )
    op.drop_table("dataset_intent_cards")
