"""Add app_settings table for LLM provider configuration.

Revision ID: 0002_app_settings
Revises: 0001_initial
Create Date: 2026-03-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_app_settings"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
