"""Add source_config column to jobs table for persistent DB credentials.

Revision ID: 0003_job_source_config
Revises: 0002_app_settings
Create Date: 2026-03-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_job_source_config"
down_revision: str | None = "0002_app_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("source_config", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("jobs", "source_config")
