"""Initial schema — all operational tables.

Revision ID: 0001_initial
Revises:
Create Date: 2026-03-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_config_safe", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("tables_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tables_processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_jobs_status", "jobs", ["status"])

    op.create_table(
        "discovered_tables",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("database_name", sa.String(255), nullable=False),
        sa.Column("schema_name", sa.String(255), nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("column_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("row_estimate", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovered_tables_job_id", "discovered_tables", ["job_id"])

    op.create_table(
        "discovered_columns",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("table_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("column_type", sa.String(128), nullable=False),
        sa.Column("is_nullable", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("column_default", sa.Text(), nullable=True),
        sa.Column("ordinal_position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_primary_key", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("foreign_key_ref", sa.String(512), nullable=True),
        sa.ForeignKeyConstraint(["table_id"], ["discovered_tables.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovered_columns_table_id", "discovered_columns", ["table_id"])

    op.create_table(
        "profile_results",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("database_name", sa.String(255), nullable=False),
        sa.Column("schema_name", sa.String(255), nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sample_rows", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_profile_results_job_id", "profile_results", ["job_id"])

    op.create_table(
        "column_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("profile_result_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("column_type", sa.String(128), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("null_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("null_percentage", sa.Float(), nullable=False, server_default="0"),
        sa.Column("approx_unique", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_val", sa.String(512), nullable=True),
        sa.Column("max_val", sa.String(512), nullable=True),
        sa.Column("avg", sa.Float(), nullable=True),
        sa.Column("std", sa.Float(), nullable=True),
        sa.Column("q25", sa.Float(), nullable=True),
        sa.Column("q50", sa.Float(), nullable=True),
        sa.Column("q75", sa.Float(), nullable=True),
        sa.Column("sample_values", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.ForeignKeyConstraint(
            ["profile_result_id"], ["profile_results.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_column_profiles_profile_result_id", "column_profiles", ["profile_result_id"])

    op.create_table(
        "relationships",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("from_database", sa.String(255), nullable=False),
        sa.Column("from_schema", sa.String(255), nullable=False),
        sa.Column("from_table", sa.String(255), nullable=False),
        sa.Column("from_column", sa.String(255), nullable=False),
        sa.Column("to_database", sa.String(255), nullable=False),
        sa.Column("to_schema", sa.String(255), nullable=False),
        sa.Column("to_table", sa.String(255), nullable=False),
        sa.Column("to_column", sa.String(255), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_relationships_job_id", "relationships", ["job_id"])

    op.create_table(
        "semantic_models",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("database_name", sa.String(255), nullable=False),
        sa.Column("schema_name", sa.String(255), nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("table_type", sa.String(32), nullable=False, server_default="unknown"),
        sa.Column("grain", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_models_job_id", "semantic_models", ["job_id"])

    op.create_table(
        "semantic_entities",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["model_id"], ["semantic_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_entities_model_id", "semantic_entities", ["model_id"])

    op.create_table(
        "semantic_dimensions",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("dim_type", sa.String(32), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("time_granularity", sa.String(32), nullable=True),
        sa.ForeignKeyConstraint(["model_id"], ["semantic_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_dimensions_model_id", "semantic_dimensions", ["model_id"])

    op.create_table(
        "semantic_measures",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("agg", sa.String(32), nullable=False),
        sa.Column("expr", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["model_id"], ["semantic_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_measures_model_id", "semantic_measures", ["model_id"])

    op.create_table(
        "semantic_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("yaml_content", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_semantic_snapshots_job_id", "semantic_snapshots", ["job_id"])


def downgrade() -> None:
    op.drop_table("semantic_snapshots")
    op.drop_table("semantic_measures")
    op.drop_table("semantic_dimensions")
    op.drop_table("semantic_entities")
    op.drop_table("semantic_models")
    op.drop_table("relationships")
    op.drop_table("column_profiles")
    op.drop_table("profile_results")
    op.drop_table("discovered_columns")
    op.drop_table("discovered_tables")
    op.drop_table("jobs")
