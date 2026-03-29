"""Add pgvector extension and table_embeddings table for semantic search.

Revision ID: 0005_embeddings
Revises: 0004_token_usage
Create Date: 2026-03-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_embeddings"
down_revision: str | None = "0004_token_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Enable the pgvector extension (idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "table_embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("schema_name", sa.String(255), nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("text_content", sa.Text, nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
    )

    # Add the vector column via raw SQL — pgvector type is not available in standard Alembic
    op.execute("ALTER TABLE table_embeddings ADD COLUMN embedding vector(1536)")

    # Unique constraint for upsert by (job_id, schema_name, table_name)
    op.create_unique_constraint(
        "uq_table_embedding",
        "table_embeddings",
        ["job_id", "schema_name", "table_name"],
    )


def downgrade() -> None:
    op.drop_table("table_embeddings")
    op.execute("DROP EXTENSION IF EXISTS vector")
