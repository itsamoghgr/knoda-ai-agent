"""Add tenant_id for multi-tenancy (Supabase auth).

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-17

Adds tenant_id (UUID) to all top-level tables so every row is scoped to one user.
Secondary tables (discovered_tables, relationships, semantic_models, etc.) are
already isolated via FK chains through job_id → jobs.tenant_id.

app_settings PK changes from (key) to (tenant_id, key) — existing global rows
are deleted since they contain no user context and are invalid in a multi-tenant setup.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_multi_tenant"
down_revision = "0006_charts_dashboards"
branch_labels = None
depends_on = None

# Sentinel UUID used to migrate any pre-existing rows in tables other than
# app_settings. Set this to your own Supabase user UUID if you want to
# preserve existing data — otherwise it is a placeholder.
_LEGACY_TENANT_ID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    # ── jobs ──────────────────────────────────────────────────────────────────
    op.add_column(
        "jobs",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.execute(f"UPDATE jobs SET tenant_id = '{_LEGACY_TENANT_ID}'")
    op.alter_column("jobs", "tenant_id", nullable=False)
    op.create_index("ix_jobs_tenant_id", "jobs", ["tenant_id"])

    # ── app_settings ──────────────────────────────────────────────────────────
    # Drop old single-column PK and all existing rows (they are not tenant-scoped)
    op.execute("DELETE FROM app_settings")
    op.drop_constraint("app_settings_pkey", "app_settings", type_="primary")
    op.add_column(
        "app_settings",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.create_primary_key("app_settings_pkey", "app_settings", ["tenant_id", "key"])
    op.create_index("ix_app_settings_tenant_id", "app_settings", ["tenant_id"])

    # ── datasets ──────────────────────────────────────────────────────────────
    op.add_column(
        "datasets",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.execute(f"UPDATE datasets SET tenant_id = '{_LEGACY_TENANT_ID}'")
    op.alter_column("datasets", "tenant_id", nullable=False)
    op.create_index("ix_datasets_tenant_id", "datasets", ["tenant_id"])

    # ── charts ────────────────────────────────────────────────────────────────
    op.add_column(
        "charts",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.execute(f"UPDATE charts SET tenant_id = '{_LEGACY_TENANT_ID}'")
    op.alter_column("charts", "tenant_id", nullable=False)
    op.create_index("ix_charts_tenant_id", "charts", ["tenant_id"])

    # ── dashboards ────────────────────────────────────────────────────────────
    op.add_column(
        "dashboards",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.execute(f"UPDATE dashboards SET tenant_id = '{_LEGACY_TENANT_ID}'")
    op.alter_column("dashboards", "tenant_id", nullable=False)
    op.create_index("ix_dashboards_tenant_id", "dashboards", ["tenant_id"])

    # ── table_embeddings ──────────────────────────────────────────────────────
    op.add_column(
        "table_embeddings",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.execute(f"UPDATE table_embeddings SET tenant_id = '{_LEGACY_TENANT_ID}'")
    op.alter_column("table_embeddings", "tenant_id", nullable=False)
    op.create_index("ix_table_embeddings_tenant_id", "table_embeddings", ["tenant_id"])

    # ── token_usage ───────────────────────────────────────────────────────────
    op.add_column(
        "token_usage",
        sa.Column("tenant_id", sa.UUID(), nullable=True),
    )
    op.execute(f"UPDATE token_usage SET tenant_id = '{_LEGACY_TENANT_ID}'")
    op.alter_column("token_usage", "tenant_id", nullable=False)
    op.create_index("ix_token_usage_tenant_id", "token_usage", ["tenant_id"])


def downgrade() -> None:
    # ── token_usage ───────────────────────────────────────────────────────────
    op.drop_index("ix_token_usage_tenant_id", "token_usage")
    op.drop_column("token_usage", "tenant_id")

    # ── table_embeddings ──────────────────────────────────────────────────────
    op.drop_index("ix_table_embeddings_tenant_id", "table_embeddings")
    op.drop_column("table_embeddings", "tenant_id")

    # ── dashboards ────────────────────────────────────────────────────────────
    op.drop_index("ix_dashboards_tenant_id", "dashboards")
    op.drop_column("dashboards", "tenant_id")

    # ── charts ────────────────────────────────────────────────────────────────
    op.drop_index("ix_charts_tenant_id", "charts")
    op.drop_column("charts", "tenant_id")

    # ── datasets ──────────────────────────────────────────────────────────────
    op.drop_index("ix_datasets_tenant_id", "datasets")
    op.drop_column("datasets", "tenant_id")

    # ── app_settings ──────────────────────────────────────────────────────────
    op.drop_index("ix_app_settings_tenant_id", "app_settings")
    op.drop_constraint("app_settings_pkey", "app_settings", type_="primary")
    op.drop_column("app_settings", "tenant_id")
    op.create_primary_key("app_settings_pkey", "app_settings", ["key"])

    # ── jobs ──────────────────────────────────────────────────────────────────
    op.drop_index("ix_jobs_tenant_id", "jobs")
    op.drop_column("jobs", "tenant_id")
