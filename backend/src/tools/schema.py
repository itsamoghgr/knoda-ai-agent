"""Schema introspection tools — use DuckDB catalog functions for reliable metadata."""

import logging
from typing import Any

from models.schema import ColumnMeta, ConstraintMeta, ConstraintType, TableMeta
from query_engine.engine import QueryEngine

logger = logging.getLogger(__name__)


def list_databases(engine: QueryEngine) -> list[str]:
    """List all databases/catalogs currently attached in the session."""
    df = engine.execute("SELECT database_name FROM duckdb_databases() WHERE NOT internal")
    return df["database_name"].tolist()


# System schemas exposed by Supabase and standard PostgreSQL that should be
# excluded by default — users can override via source_config.include_schemas.
_DEFAULT_SYSTEM_SCHEMAS: frozenset[str] = frozenset({
    # Standard PostgreSQL
    "information_schema", "pg_catalog", "pg_toast", "pg_temp_1", "pg_toast_temp_1",
    # Supabase platform schemas
    "auth", "storage", "extensions", "graphql", "graphql_public",
    "pgsodium", "pgsodium_masks", "vault", "realtime", "_realtime",
    "supabase_migrations", "supabase_functions", "cron", "pgbouncer",
    # Other common system schemas
    "tiger", "tiger_data", "topology",
})


def list_schemas(
    engine: QueryEngine,
    database: str,
    include_schemas: list[str] | None = None,
    exclude_schemas: list[str] | None = None,
) -> list[str]:
    """List all non-system schemas in a database.

    If include_schemas is provided, only those schemas are returned.
    Otherwise, well-known system schemas are excluded automatically and
    any additional schemas in exclude_schemas are also dropped.
    """
    df = engine.execute(
        f"SELECT schema_name FROM duckdb_schemas() "
        f"WHERE database_name = '{database}' AND NOT internal"
    )
    schemas: list[str] = df["schema_name"].tolist()

    if include_schemas:
        return [s for s in schemas if s in include_schemas]

    excluded = _DEFAULT_SYSTEM_SCHEMAS | set(exclude_schemas or [])
    return [s for s in schemas if s not in excluded]


def list_tables(engine: QueryEngine, database: str, schema: str) -> list[TableMeta]:
    """List all tables in a schema with column count and row estimate."""
    df = engine.execute(
        f"SELECT table_name, column_count, estimated_size "
        f"FROM duckdb_tables() "
        f"WHERE database_name = '{database}' AND schema_name = '{schema}' AND NOT internal"
    )
    tables = []
    for _, row in df.iterrows():
        tables.append(
            TableMeta(
                database_name=database,
                schema_name=schema,
                table_name=str(row["table_name"]),
                column_count=int(row["column_count"] or 0),
                row_estimate=int(row["estimated_size"] or 0),
            )
        )
    return tables


def describe_table(engine: QueryEngine, database: str, schema: str, table: str) -> TableMeta:
    """Get full column metadata and constraints for a specific table."""
    cols_df = engine.execute(
        f"SELECT column_name, data_type AS column_type, is_nullable, column_default, column_index "
        f"FROM duckdb_columns() "
        f"WHERE database_name = '{database}' "
        f"  AND schema_name = '{schema}' "
        f"  AND table_name = '{table}' "
        f"ORDER BY column_index"
    )

    # Use information_schema for constraints — works for both native DuckDB and
    # attached external sources (postgres scanner, etc.) where duckdb_constraints()
    # exposes a reduced schema without fk_table / constraint_column_names.
    pk_cols: set[str] = set()
    fk_map: dict[str, str] = {}
    constraints: list[ConstraintMeta] = []

    try:
        pk_df = engine.execute(
            f"SELECT kcu.column_name "
            f"FROM information_schema.table_constraints tc "
            f"JOIN information_schema.key_column_usage kcu "
            f"  ON tc.constraint_name = kcu.constraint_name "
            f"  AND tc.table_schema = kcu.table_schema "
            f"  AND tc.table_name = kcu.table_name "
            f"WHERE tc.table_schema = '{schema}' "
            f"  AND tc.table_name = '{table}' "
            f"  AND tc.constraint_type = 'PRIMARY KEY'"
        )
        pk_cols = set(pk_df["column_name"].tolist())
        if pk_cols:
            constraints.append(
                ConstraintMeta(
                    constraint_type=ConstraintType.PRIMARY_KEY,
                    column_names=list(pk_cols),
                )
            )
    except Exception as exc:
        logger.debug("PK lookup failed for %s.%s.%s: %s", database, schema, table, exc)

    try:
        fk_df = engine.execute(
            f"SELECT kcu.column_name, ccu.table_name AS fk_table, ccu.column_name AS fk_col "
            f"FROM information_schema.table_constraints tc "
            f"JOIN information_schema.key_column_usage kcu "
            f"  ON tc.constraint_name = kcu.constraint_name "
            f"  AND tc.table_schema = kcu.table_schema "
            f"  AND tc.table_name = kcu.table_name "
            f"JOIN information_schema.constraint_column_usage ccu "
            f"  ON tc.constraint_name = ccu.constraint_name "
            f"WHERE tc.table_schema = '{schema}' "
            f"  AND tc.table_name = '{table}' "
            f"  AND tc.constraint_type = 'FOREIGN KEY'"
        )
        for _, row in fk_df.iterrows():
            src = str(row["column_name"])
            ref_table = str(row["fk_table"])
            ref_col = str(row["fk_col"])
            fk_map[src] = f"{ref_table}.{ref_col}"
            constraints.append(
                ConstraintMeta(
                    constraint_type=ConstraintType.FOREIGN_KEY,
                    column_names=[src],
                    fk_table=ref_table,
                    fk_column_names=[ref_col],
                )
            )
    except Exception as exc:
        logger.debug("FK lookup failed for %s.%s.%s: %s", database, schema, table, exc)

    columns: list[ColumnMeta] = []
    for _, row in cols_df.iterrows():
        col_name = str(row["column_name"])
        columns.append(
            ColumnMeta(
                column_name=col_name,
                column_type=str(row["column_type"]),
                is_nullable=bool(row.get("is_nullable", True)),
                column_default=str(row["column_default"]) if row.get("column_default") else None,
                ordinal_position=int(row.get("column_index", 0)),
                is_primary_key=col_name in pk_cols,
                foreign_key_ref=fk_map.get(col_name),
            )
        )

    return TableMeta(
        database_name=database,
        schema_name=schema,
        table_name=table,
        column_count=len(columns),
        columns=columns,
        constraints=constraints,
    )


def get_table_row_count(engine: QueryEngine, fqn: str) -> int:
    """Get approximate row count for a fully-qualified table."""
    try:
        df = engine.execute(f"SELECT COUNT(*) AS cnt FROM {fqn}")
        return int(df["cnt"].iloc[0])
    except Exception:
        return 0


def to_tool_dict(table: TableMeta) -> dict[str, Any]:
    """Serialize a TableMeta for passing to the LLM as tool output."""
    return {
        "table": table.fully_qualified_name,
        "columns": [
            {
                "name": c.column_name,
                "type": c.column_type,
                "nullable": c.is_nullable,
                "primary_key": c.is_primary_key,
                "fk_ref": c.foreign_key_ref,
            }
            for c in table.columns
        ],
    }
