"""Add datasets, charts, dashboards, and dashboard_charts tables.

Revision ID: 0006_charts_dashboards
Revises: 0005_embeddings
Create Date: 2026-03-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0006_charts_dashboards"
down_revision: str | None = "0005_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("job_id", UUID(as_uuid=False), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("sql", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_datasets_job_id", "datasets", ["job_id"])

    op.create_table(
        "charts",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("dataset_id", UUID(as_uuid=False), sa.ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("chart_type", sa.String(50), nullable=False),
        sa.Column("config", JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_charts_dataset_id", "charts", ["dataset_id"])

    op.create_table(
        "dashboards",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "dashboard_charts",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("dashboard_id", UUID(as_uuid=False), sa.ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chart_id", UUID(as_uuid=False), sa.ForeignKey("charts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("grid_x", sa.Integer, nullable=False, server_default="0"),
        sa.Column("grid_y", sa.Integer, nullable=False, server_default="0"),
        sa.Column("grid_w", sa.Integer, nullable=False, server_default="6"),
        sa.Column("grid_h", sa.Integer, nullable=False, server_default="4"),
        sa.UniqueConstraint("dashboard_id", "chart_id", name="uq_dashboard_chart"),
    )
    op.create_index("ix_dashboard_charts_dashboard_id", "dashboard_charts", ["dashboard_id"])
    op.create_index("ix_dashboard_charts_chart_id", "dashboard_charts", ["chart_id"])


def downgrade() -> None:
    op.drop_table("dashboard_charts")
    op.drop_table("dashboards")
    op.drop_table("charts")
    op.drop_table("datasets")
