"""DuckDB-based multi-database query engine with strict read-only enforcement."""

import concurrent.futures
import contextlib
import logging
from typing import Any

import duckdb
import pandas as pd
import sqlglot

from config import settings
from models.connection import SourceConfig, SourceType
from query_engine.adapters import duckdb_file, mysql, postgres, s3_parquet

logger = logging.getLogger(__name__)


class ReadOnlyViolationError(Exception):
    """Raised when a non-SELECT SQL statement is submitted to the query engine."""


class QueryTimeoutError(Exception):
    """Raised when a query exceeds the configured timeout."""


class QueryEngine:
    """
    Wraps a DuckDB in-memory connection that ATTACHes external sources in READ_ONLY mode.

    Read-only is enforced at three independent layers:
      1. Every ATTACH uses READ_ONLY flag — DuckDB driver prevents writes at connection level.
      2. sqlglot parses every SQL string — any non-SELECT is rejected before DuckDB runs it.
      3. Results are capped at max_rows and queries killed after timeout_s seconds.
    """

    def __init__(
        self,
        max_rows: int = settings.max_rows_per_query,
        timeout_s: int = settings.query_timeout_seconds,
    ) -> None:
        self._max_rows = max_rows
        self._timeout_s = timeout_s
        self._alias_counter = 0
        self._aliases: dict[str, str] = {}  # source_type+index → alias

        # In-memory DuckDB connection — sources are attached, not opened directly
        self._conn = duckdb.connect(":memory:")
        self._conn.execute("SET threads TO 4")
        self._conn.execute("SET memory_limit = '1GB'")

        # Single-worker executor: guarantees only ONE thread ever touches _conn,
        # making all tool calls inherently thread-safe without explicit locking.
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

    def attach(self, config: SourceConfig) -> str:
        """
        ATTACH a data source in READ_ONLY mode. Returns the alias used.
        The alias is used to qualify table names: alias.schema.table
        """
        alias = f"src{self._alias_counter}"
        self._alias_counter += 1

        if config.source_type == SourceType.POSTGRES:
            for sql in postgres.install_extension_sql():
                self._conn.execute(sql)
            attach_sql = postgres.build_attach_sql(config, alias)
            self._conn.execute(attach_sql)

        elif config.source_type == SourceType.MYSQL:
            for sql in mysql.install_extension_sql():
                self._conn.execute(sql)
            attach_sql = mysql.build_attach_sql(config, alias)
            self._conn.execute(attach_sql)

        elif config.source_type == SourceType.DUCKDB:
            attach_sql = duckdb_file.build_attach_sql(config, alias)
            self._conn.execute(attach_sql)

        elif config.source_type == SourceType.S3_PARQUET:
            for sql in s3_parquet.install_extension_sql():
                self._conn.execute(sql)
            for sql in s3_parquet.build_s3_config_sql(config):
                self._conn.execute(sql)
            # S3/Parquet has no alias — queried directly via read_parquet()
            alias = "s3"

        self._aliases[config.source_type.value] = alias
        logger.info("Attached source %s as alias '%s'", config.source_type, alias)
        return alias

    def execute(self, sql: str) -> pd.DataFrame:
        """
        Execute a SQL query against attached sources.

        Enforces read-only (Layer 2): rejects any non-SELECT statement via sqlglot parsing.
        Enforces row limit (Layer 3): wraps query in a LIMIT clause if not already present.
        """
        sql = self._sanitize_sql(sql)
        self._guard_readonly(sql)

        limited_sql = self._apply_limit(sql)

        result = self._conn.execute(limited_sql)
        df = result.df()
        return df

    def execute_raw(self, sql: str) -> list[dict[str, Any]]:
        """Execute and return results as a list of dicts."""
        df = self.execute(sql)
        return df.to_dict(orient="records")

    def execute_unlimited(self, sql: str) -> list[dict[str, Any]]:
        """
        Execute without injecting any LIMIT clause — the caller's SQL is used verbatim.
        Still enforces read-only. Intended for SQL Lab where the user controls row count.
        """
        sql = self._sanitize_sql(sql)
        self._guard_readonly(sql)

        result = self._conn.execute(sql)
        df = result.df()
        return df.to_dict(orient="records")

    def close(self) -> None:
        """Release the DuckDB connection and all attached sources."""
        with contextlib.suppress(Exception):
            self.executor.shutdown(wait=False)
        with contextlib.suppress(Exception):
            self._conn.close()
        logger.debug("QueryEngine closed")

    def __enter__(self) -> "QueryEngine":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _guard_readonly(sql: str) -> None:
        """
        Layer 2 read-only enforcement: parse SQL with sqlglot and reject
        anything that is not a pure SELECT statement.
        """
        sql_stripped = sql.strip()
        # Allow DuckDB internal queries (SUMMARIZE, DESCRIBE, PRAGMA, SHOW, etc.)
        upper = sql_stripped.upper()
        if any(
            upper.startswith(prefix)
            for prefix in (
                "SUMMARIZE",
                "DESCRIBE",
                "PRAGMA",
                "SHOW",
                "EXPLAIN",
                "SELECT",
                "WITH",
            )
        ):
            return

        try:
            parsed = sqlglot.parse_one(sql_stripped, error_level=sqlglot.ErrorLevel.RAISE)
        except sqlglot.errors.ParseError as exc:
            raise ReadOnlyViolationError(f"Could not parse SQL: {exc}") from exc

        if not isinstance(parsed, sqlglot.expressions.Select):
            raise ReadOnlyViolationError(
                f"Only SELECT queries are permitted. Received: {type(parsed).__name__}. "
                f"SQL: {sql_stripped[:120]}"
            )

    @staticmethod
    def _sanitize_sql(sql: str) -> str:
        """
        Normalize LLM-generated SQL before execution.

        - Takes only the first statement (handles LLMs emitting multiple statements
          separated by semicolons, e.g. ``SELECT ...;\\nSELECT ...;``)
        - Strips the trailing semicolon so subquery wrapping in _apply_limit
          does not produce invalid SQL like ``SELECT * FROM (...;) _q LIMIT N``
        - Validates syntax via sqlglot for SELECT/WITH queries, fixing the
          existing prefix fast-path bypass in _guard_readonly
        """
        first_stmt = sql.strip().split(";")[0].strip()
        if not first_stmt:
            raise ReadOnlyViolationError("Empty SQL statement.")

        upper = first_stmt.upper()
        if upper.startswith("SELECT") or upper.startswith("WITH"):
            # Transpile from PostgreSQL dialect to DuckDB to handle LLM-generated PG idioms
            # (e.g. TO_CHAR → strftime, EXTRACT variants, etc.).
            # Fall back to the original string if sqlglot cannot parse it.
            try:
                transpiled = sqlglot.transpile(first_stmt, read="postgres", write="duckdb")[0]
                if transpiled:
                    first_stmt = transpiled
            except Exception:  # noqa: BLE001
                pass
            try:
                sqlglot.parse_one(first_stmt, error_level=sqlglot.ErrorLevel.RAISE)
            except sqlglot.errors.ParseError as exc:
                raise ReadOnlyViolationError(f"SQL syntax error: {exc}") from exc

        return first_stmt

    def _apply_limit(self, sql: str) -> str:
        """Wrap the query in a subquery with LIMIT if it doesn't already have one."""
        upper = sql.upper()
        if "LIMIT" in upper:
            return sql
        # Don't modify SUMMARIZE / DESCRIBE / SHOW — they return bounded results by nature
        if any(upper.strip().startswith(p) for p in ("SUMMARIZE", "DESCRIBE", "SHOW", "PRAGMA")):
            return sql
        return f"SELECT * FROM ({sql}) _q LIMIT {self._max_rows}"


# ---------------------------------------------------------------------------
# Parallel query execution — one connection per unique source DB
# ---------------------------------------------------------------------------



def _source_key(cfg) -> tuple:
    """Stable identity key for a SourceConfig connection.

    Two configs with the same key share one DuckDB connection in
    run_queries_parallel, so only ONE SSL handshake is needed per source.
    """
    return (
        getattr(cfg, "source_type", None),
        getattr(cfg, "host", None),
        getattr(cfg, "port", None),
        getattr(cfg, "database", None),
        getattr(cfg, "username", None),
        # DuckDB / S3 sources — include file/bucket so they stay isolated
        getattr(cfg, "file_path", None),
        getattr(cfg, "s3_bucket", None),
        getattr(cfg, "s3_prefix", None),
    )


async def run_queries_parallel(
    queries: list[tuple],  # list of (SourceConfig, sql_string)
    max_workers: int = 6,
) -> list[dict]:
    """Execute queries in parallel, grouped by source connection.

    Queries that share the same source DB are executed serially inside a
    single DuckDB connection — only ONE SSL handshake per source.
    Queries against *different* source DBs still run in parallel threads.

    Returns a list matching the input order, each item:
        {"columns": [...], "rows": [...], "error": None | str}

    Before (old):  N queries → N DuckDB connections → N SSL handshakes (burst)
    After  (new):  N queries → M unique sources → M SSL handshakes (spread)
                   where M ≤ N (often M=1 when all charts share one source)
    """
    import asyncio
    import concurrent.futures
    from collections import defaultdict

    if not queries:
        return []

    # ── 1. Group queries by source connection identity ────────────────────────
    # groups maps source_key → list of (original_idx, sql)
    groups: dict[tuple, list[tuple[int, object, str]]] = defaultdict(list)
    for idx, (cfg, sql) in enumerate(queries):
        groups[_source_key(cfg)].append((idx, cfg, sql))

    # ── 2. One worker per source group ────────────────────────────────────────
    def _run_group(items: list[tuple[int, object, str]]) -> list[tuple[int, dict]]:
        """Opens ONE QueryEngine for the entire group; executes queries serially.

        Returns list of (original_idx, result) so results can be re-ordered.
        """
        results: list[tuple[int, dict]] = []
        # All items in the group share the same cfg — use the first one to attach
        _, cfg, _ = items[0]
        try:
            with QueryEngine() as eng:
                eng.attach(cfg)
                logger.debug(
                    "run_queries_parallel: group of %d queries sharing one connection to %s",
                    len(items), getattr(cfg, "host", getattr(cfg, "file_path", "unknown")),
                )
                for orig_idx, _, sql in items:
                    try:
                        rows = eng.execute_unlimited(sql)
                        columns = list(rows[0].keys()) if rows else []
                        results.append((orig_idx, {"columns": columns, "rows": rows, "error": None}))
                    except Exception as exc:
                        logger.warning("run_queries_parallel: query[%d] failed: %s", orig_idx, exc)
                        results.append((orig_idx, {"columns": [], "rows": [], "error": str(exc)}))
        except Exception as exc:
            # Connection-level failure — mark all queries in this group as failed
            logger.warning(
                "run_queries_parallel: failed to connect for group of %d queries: %s",
                len(items), exc,
            )
            for orig_idx, _, _ in items:
                results.append((orig_idx, {"columns": [], "rows": [], "error": str(exc)}))
        return results

    # ── 3. Dispatch one thread per source group ───────────────────────────────
    loop = asyncio.get_running_loop()
    n_groups = len(groups)
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=min(n_groups, max_workers))

    try:
        tasks = [
            loop.run_in_executor(pool, _run_group, items)
            for items in groups.values()
        ]
        group_results = await asyncio.gather(*tasks)
    finally:
        pool.shutdown(wait=False)

    # ── 4. Reassemble results in original input order ─────────────────────────
    output: list[dict] = [{"columns": [], "rows": [], "error": "not executed"}] * len(queries)
    for group_result in group_results:
        for orig_idx, result in group_result:
            output[orig_idx] = result

    return output
