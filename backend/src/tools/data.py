"""Data query tool — wraps DuckDB read-only SQL execution."""

import logging
from typing import Any

import pandas as pd

from query_engine.engine import QueryEngine

logger = logging.getLogger(__name__)


def execute_sql(engine: QueryEngine, sql: str) -> list[dict[str, Any]]:
    """
    Execute any read-only SQL query and return results as a list of dicts.
    The QueryEngine enforces read-only — non-SELECT statements are rejected.
    """
    df = engine.execute(sql)
    return _df_to_safe_records(df)


def _df_to_safe_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Convert DataFrame to JSON-safe list of dicts (handles numpy/pandas types)."""
    records = []
    for _, row in df.iterrows():
        safe_row: dict[str, Any] = {}
        for col, val in row.items():
            if pd.isna(val) if not isinstance(val, (list, dict)) else False:
                safe_row[str(col)] = None
            else:
                safe_row[str(col)] = val if isinstance(val, (str, int, float, bool)) else str(val)
        records.append(safe_row)
    return records
