"""Shared agent infrastructure — tool implementations and context dataclass.

All tool logic lives here as plain Python functions. Each sub-agent (discovery,
analyst) wraps the functions it needs as @tool closures capturing an
AgentToolsContext instance.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import UTC
from typing import TYPE_CHECKING, Any

from models.relationship import Relationship, RelationshipSource
from models.semantic import (
    Dimension,
    DimensionType,
    Entity,
    EntityType,
    Measure,
    MeasureAgg,
    SemanticModel,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from models.schema import TableMeta
    from query_engine.engine import QueryEngine

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_embedding_text(model) -> str:
    """Build a rich plain-text representation of a SemanticModel for embedding."""

    parts = [f"Table: {model.schema_name}.{model.table_name}"]
    if model.description:
        parts.append(f"Description: {model.description}")
    if model.table_type:
        parts.append(f"Type: {model.table_type}")
    if model.grain:
        parts.append(f"Grain: {model.grain}")
    if hasattr(model, "entities") and model.entities:
        names = ", ".join(e.entity_name for e in model.entities)
        parts.append(f"Keys: {names}")
    if hasattr(model, "dimensions") and model.dimensions:
        dims = ", ".join(d.column_name for d in model.dimensions[:20])
        parts.append(f"Dimensions: {dims}")
    if hasattr(model, "measures") and model.measures:
        meas = ", ".join(m.column_name for m in model.measures[:10])
        parts.append(f"Measures: {meas}")
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# Context dataclass — passed to every agent
# ---------------------------------------------------------------------------


@dataclass
class AgentToolsContext:
    """Carries all shared state and DB connections needed by agent tools."""

    job_id: str
    engine: QueryEngine
    # Callable that returns an async context manager yielding an AsyncSession.
    # Use: async with ctx.session_factory() as s: ...
    session_factory: Callable
    tenant_id: str = ""  # user/tenant UUID — scopes all DB queries
    alias_map: dict[str, str] = field(default_factory=dict)  # job_id → alias

    # Runtime state accumulated during discovery
    tables_discovered: list[TableMeta] = field(default_factory=list)
    tables_total: int = 0
    tables_saved: int = 0
    relationships_saved: list[Relationship] = field(default_factory=list)
    semantic_models_saved: list[SemanticModel] = field(default_factory=list)

    # Token usage
    input_tokens: int = 0
    output_tokens: int = 0


# ---------------------------------------------------------------------------
# LLM factory (single source of truth for all agents)
# ---------------------------------------------------------------------------


def build_llm(
    provider: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> Any:
    """Construct a LangChain chat model from explicit params or env fallbacks."""
    from config import settings

    llm_provider = provider or settings.llm_provider
    llm_api_key = api_key or settings.llm_api_key
    llm_model = model or settings.llm_model

    if llm_provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=llm_model, api_key=llm_api_key, max_tokens=8096)

    elif llm_provider == "ollama":
        from langchain_community.chat_models import ChatOllama  # type: ignore[import]

        return ChatOllama(model=llm_model)

    elif llm_provider == "groq":
        from langchain_groq import ChatGroq

        return ChatGroq(model=llm_model, api_key=llm_api_key, temperature=0, max_tokens=8096)

    elif llm_provider == "featherless":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=llm_model,
            api_key=llm_api_key,
            base_url="https://api.featherless.ai/v1",
            temperature=0,
            stream_options={"include_usage": True},
        )

    else:  # openai (default)
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=llm_model,
            api_key=llm_api_key,
            temperature=0,
            stream_options={"include_usage": True},
        )


# ---------------------------------------------------------------------------
# Shared tool implementations (plain functions — wrapped as @tool per agent)
# ---------------------------------------------------------------------------


async def tool_list_databases(ctx: AgentToolsContext) -> str:
    """List all databases currently attached to the DuckDB session with their aliases."""
    from tools.schema import list_databases as _list_dbs

    loop = asyncio.get_running_loop()
    try:
        db_names: list[str] = await loop.run_in_executor(ctx.engine.executor, _list_dbs, ctx.engine)
    except Exception as exc:
        return f"Error listing databases: {exc}"

    if not db_names:
        return "No databases attached."

    lines = ["Connected databases:"]
    for db in db_names:
        alias = next((a for a in ctx.alias_map.values()), db)
        lines.append(f"  - alias: {alias}  (database: {db})")
        lines.append(f"    Use as: {alias}.<schema>.<table>  e.g. {alias}.public.users")
    return "\n".join(lines)


async def tool_explore_schema(ctx: AgentToolsContext, database_alias: str | None = None) -> str:
    """List all schemas and tables in an attached database.

    Returns a compact overview of every schema + table with column count and
    row estimate. Use this first to understand the full structure before
    calling describe_table on specific tables.
    """
    from tools.schema import list_databases as _list_dbs
    from tools.schema import list_schemas as _list_schemas
    from tools.schema import list_tables as _list_tbls

    loop = asyncio.get_running_loop()
    ex = ctx.engine.executor  # shared single-worker executor — serial DuckDB access

    try:
        db_names: list[str] = await loop.run_in_executor(ex, _list_dbs, ctx.engine)
    except Exception as exc:
        return f"Error: {exc}"

    if not db_names:
        return "No databases attached."

    lines: list[str] = []
    all_tables: list[TableMeta] = []

    for db in db_names:
        lines.append(f"=== {db} ===")
        try:
            schemas: list[str] = await loop.run_in_executor(
                ex, _list_schemas, ctx.engine, db, None, None
            )
        except Exception as exc:
            lines.append(f"  Could not list schemas: {exc}")
            continue

        for schema in schemas:
            try:
                tables = await loop.run_in_executor(ex, _list_tbls, ctx.engine, db, schema)
            except Exception as exc:
                lines.append(f"  {schema}: error — {exc}")
                continue

            if not tables:
                continue

            lines.append(f"  Schema: {schema}")
            for t in tables:
                row_str = f"~{t.row_estimate:,} rows" if t.row_estimate else "rows unknown"
                lines.append(f"    - {t.table_name}  ({t.column_count} cols, {row_str})")
                all_tables.append(t)

    # Store discovered tables for later use by discovery agent
    if all_tables:
        ctx.tables_discovered = all_tables
        ctx.tables_total = len(all_tables)

    lines.append(f"\nTotal: {len(all_tables)} table(s) found.")
    return "\n".join(lines)


async def tool_describe_table(ctx: AgentToolsContext, table_fqn: str) -> str:
    """Get full column schema for a table: names, types, nullability, PKs and FK references.

    table_fqn format: alias.schema.table  (e.g. src0.public.orders)
    Call this before writing SQL that touches this table.
    """
    from tools.schema import describe_table as _describe

    parts = table_fqn.strip().split(".")
    if len(parts) == 3:
        alias_part, schema, table = parts
        # DuckDB catalog database name equals the alias used in ATTACH ... AS <alias>
        db = alias_part
    elif len(parts) == 2:
        schema, table = parts
        db = _get_primary_db(ctx)
    else:
        return f"Invalid table FQN '{table_fqn}'. Expected format: alias.schema.table"

    loop = asyncio.get_running_loop()
    try:
        meta: TableMeta = await loop.run_in_executor(
            ctx.engine.executor, _describe, ctx.engine, db, schema, table
        )
    except Exception as exc:
        return f"Error describing table {table_fqn}: {exc}"

    # Update the lightweight stub in tables_discovered with full column data
    for i, existing in enumerate(ctx.tables_discovered):
        if existing.schema_name == schema and existing.table_name == table:
            ctx.tables_discovered[i] = meta
            break
    else:
        # Table wasn't in the list yet (e.g. analyst agent call) — just add it
        ctx.tables_discovered.append(meta)

    lines = [f"Table: {table_fqn}  ({len(meta.columns)} columns)"]
    for col in meta.columns:
        flags: list[str] = []
        if col.is_primary_key:
            flags.append("PK")
        if not col.is_nullable:
            flags.append("NOT NULL")
        if col.foreign_key_ref:
            flags.append(f"FK → {col.foreign_key_ref}")
        flag_str = f"  [{', '.join(flags)}]" if flags else ""
        lines.append(f"  {col.column_name:<24} {col.column_type:<16}{flag_str}")

    return "\n".join(lines)


async def tool_execute_sql(ctx: AgentToolsContext, sql: str) -> str:
    """Execute a read-only SQL SELECT query against the connected database(s).

    Returns up to 100 rows as JSON. Always qualify table names with the alias
    shown in list_databases() (e.g. src0.public.orders).

    Write complex SQL when needed: JOINs, CTEs, subqueries, window functions.
    Example JOIN: SELECT c.name, SUM(o.total) FROM src0.public.orders o
                  JOIN src0.public.customers c ON o.customer_id = c.id
                  GROUP BY c.name ORDER BY 2 DESC LIMIT 20
    """
    from tools.data import execute_sql as _exec

    loop = asyncio.get_running_loop()
    try:
        rows = await loop.run_in_executor(ctx.engine.executor, _exec, ctx.engine, sql)
    except Exception as exc:
        return json.dumps({"error": str(exc), "rows": [], "truncated": False})

    truncated = len(rows) >= 100
    return json.dumps({"rows": rows[:100], "truncated": truncated, "error": None}, default=str)


async def tool_get_cataloged_tables(ctx: AgentToolsContext) -> str:
    """List tables that have already been cataloged/classified in this job.

    Returns table names, types (fact/dimension/bridge), and descriptions.
    Use this in the analyst agent to quickly find relevant tables by description.
    """
    from storage.repositories import SemanticRepository

    try:
        async with ctx.session_factory() as s:
            models = await SemanticRepository(s).list_models(ctx.job_id)
    except Exception as exc:
        return f"Error fetching cataloged tables: {exc}"

    if not models:
        return "No tables have been cataloged yet. Run discovery first."

    lines = [f"Cataloged tables ({len(models)} total):"]
    for m in models:
        fqn = f"{m.schema_name}.{m.table_name}" if m.schema_name else m.table_name
        alias = next(iter(ctx.alias_map.values()), "")
        full = f"{alias}.{fqn}" if alias else fqn
        lines.append(f"  {full:<45} [{m.table_type}]  {m.description}")
    return "\n".join(lines)


async def tool_search_tables(ctx: AgentToolsContext, query: str) -> str:
    """Search for tables relevant to the query using semantic similarity.

    query: describe what data you need (e.g. "customer orders with revenue totals").
    Returns the top matching tables with their types and descriptions.
    Always call this before writing SQL to find the right tables to use.
    """
    from embeddings.service import EmbeddingService
    from storage.repositories import EmbeddingRepository, SemanticRepository, SettingsRepository

    alias = next(iter(ctx.alias_map.values()), "")

    # ── Try vector search ────────────────────────────────────────────────────
    try:
        async with ctx.session_factory() as s:
            api_key, model = await SettingsRepository(s, ctx.tenant_id).get_embedding_config()

        if api_key:
            svc = EmbeddingService(api_key=api_key)
            query_vector = await svc.embed(query)

            if query_vector:
                async with ctx.session_factory() as s:
                    matches = await EmbeddingRepository(s, ctx.tenant_id).search(
                        query_embedding=query_vector,
                        job_id=ctx.job_id or None,
                        top_k=10,
                    )
                if matches:
                    lines = [f"Top {len(matches)} tables relevant to '{query}' (semantic search):"]
                    for m in matches:
                        fqn = (
                            f"{alias}.{m.schema_name}.{m.table_name}"
                            if alias
                            else f"{m.schema_name}.{m.table_name}"
                        )
                        lines.append(f"  {fqn}")
                        lines.append(
                            f"    {m.text_content.splitlines()[0] if m.text_content else ''}"
                        )
                    return "\n".join(lines)
    except Exception as exc:
        logger.warning("Vector search failed, falling back to keyword search: %s", exc)

    # ── Keyword fallback ─────────────────────────────────────────────────────
    try:
        async with ctx.session_factory() as s:
            if ctx.job_id:
                models = await SemanticRepository(s).list_models(ctx.job_id)
            else:
                all_models = await SemanticRepository(s).list_all_models()
                models = [m for _, m in all_models]
    except Exception as exc:
        return f"Error fetching tables: {exc}"

    if not models:
        return "No tables have been cataloged yet. Run discovery first."

    # Score by keyword overlap
    terms = query.lower().split()

    def score(m):
        text = f"{m.table_name} {m.description} {m.grain}".lower()
        return sum(t in text for t in terms)

    ranked = sorted(models, key=score, reverse=True)
    relevant = [m for m in ranked if score(m) > 0] or ranked[:15]

    lines = [f"Top {len(relevant[:15])} tables relevant to '{query}' (keyword search):"]
    for m in relevant[:15]:
        fqn = (
            f"{alias}.{m.schema_name}.{m.table_name}"
            if alias
            else f"{m.schema_name}.{m.table_name}"
        )
        lines.append(f"  {fqn:<50} [{m.table_type}]  {m.description}")
    return "\n".join(lines)


async def tool_get_relationships(ctx: AgentToolsContext) -> str:
    """Get all known FK and inferred relationships for this database.

    Returns join paths in the form: alias.schema.table.col → alias.schema.table.col
    Use these to determine how to JOIN tables in SQL queries.
    """
    from storage.repositories import RelationshipRepository

    try:
        async with ctx.session_factory() as s:
            rels = await RelationshipRepository(s).list_by_job(ctx.job_id)
    except Exception as exc:
        return f"Error fetching relationships: {exc}"

    if not rels:
        return "No relationships found for this job."

    alias = next(iter(ctx.alias_map.values()), "")
    lines = [f"Relationships ({len(rels)} total):"]
    for r in rels:
        src = (
            f"{alias}.{r.from_schema}.{r.from_table}.{r.from_column}"
            if alias
            else f"{r.from_table}.{r.from_column}"
        )
        tgt = (
            f"{alias}.{r.to_schema}.{r.to_table}.{r.to_column}"
            if alias
            else f"{r.to_table}.{r.to_column}"
        )
        src_label = (
            "FK" if r.source == RelationshipSource.EXPLICIT else f"inferred ({r.confidence:.0%})"
        )
        lines.append(f"  {src}  →  {tgt}  ({src_label})")
    return "\n".join(lines)


async def tool_get_semantic_catalog(ctx: AgentToolsContext) -> str:
    """Load the complete pre-built semantic catalog for this database.

    Returns ALL tables with their descriptions, types (fact/dimension/bridge),
    grain, key columns, dimensions, measures, and relationship summary.

    Call this FIRST for any question about the database schema, tables, or
    relationships. This reads from pre-computed knowledge — no live DB calls.
    Only call search_tables / describe_table / execute_sql after this.
    """
    from storage.repositories import RelationshipRepository, SemanticRepository

    try:
        async with ctx.session_factory() as s:
            if ctx.job_id:
                models = await SemanticRepository(s).list_models(ctx.job_id)
            else:
                all_models = await SemanticRepository(s).list_all_models()
                models = [m for _, m in all_models]
    except Exception as exc:
        return f"Error loading semantic catalog: {exc}"

    if not models:
        return (
            "No semantic catalog found. Discovery has not been run yet — "
            "ask the user to start a discovery job for this database first."
        )

    # Load relationships for the join-path summary
    rel_lines: list[str] = []
    try:
        async with ctx.session_factory() as s:
            rels = await RelationshipRepository(s).list_by_job(ctx.job_id)
        alias = next(iter(ctx.alias_map.values()), "")
        for r in rels:
            src = (
                f"{alias}.{r.from_schema}.{r.from_table}.{r.from_column}"
                if alias
                else f"{r.from_table}.{r.from_column}"
            )
            tgt = (
                f"{alias}.{r.to_schema}.{r.to_table}.{r.to_column}"
                if alias
                else f"{r.to_table}.{r.to_column}"
            )
            label = (
                "FK"
                if r.source == RelationshipSource.EXPLICIT
                else f"inferred ({r.confidence:.0%})"
            )
            rel_lines.append(f"  {src}  →  {tgt}  ({label})")
    except Exception:
        pass

    alias = next(iter(ctx.alias_map.values()), "")
    facts = [m for m in models if m.table_type == "fact"]
    dims = [m for m in models if m.table_type == "dimension"]
    bridges = [m for m in models if m.table_type == "bridge"]
    others = [m for m in models if m.table_type not in ("fact", "dimension", "bridge")]

    lines = [
        f"Semantic Catalog — {len(models)} tables  |  "
        f"{len(facts)} fact, {len(dims)} dimension, {len(bridges)} bridge"
        + (f", {len(others)} other" if others else ""),
        "",
    ]

    def _format_model(m) -> list[str]:
        fqn = (
            f"{alias}.{m.schema_name}.{m.table_name}"
            if alias
            else f"{m.schema_name}.{m.table_name}"
        )
        out = [f"[{m.table_type.upper()}] {fqn}"]
        if m.description:
            out.append(f"  Description : {m.description}")
        if m.grain:
            out.append(f"  Grain       : {m.grain}")
        pk_cols = [e.column_name for e in m.entities if e.entity_type.value == "primary"]
        fk_cols = [f"{e.column_name}" for e in m.entities if e.entity_type.value == "foreign"]
        if pk_cols:
            out.append(f"  Primary key : {', '.join(pk_cols)}")
        if fk_cols:
            out.append(f"  Foreign keys: {', '.join(fk_cols)}")
        if m.dimensions:
            dim_names = ", ".join(d.column_name for d in m.dimensions[:12])
            suffix = f" (+{len(m.dimensions) - 12} more)" if len(m.dimensions) > 12 else ""
            out.append(f"  Dimensions  : {dim_names}{suffix}")
        if m.measures:
            meas_names = ", ".join(f"{ms.name} ({ms.agg})" for ms in m.measures[:8])
            out.append(f"  Measures    : {meas_names}")
        return out

    for group_label, group in [
        ("FACT TABLES", facts),
        ("DIMENSION TABLES", dims),
        ("BRIDGE TABLES", bridges),
        ("OTHER TABLES", others),
    ]:
        if not group:
            continue
        lines.append(f"── {group_label} ──")
        for m in group:
            lines.extend(_format_model(m))
            lines.append("")

    if rel_lines:
        lines.append(f"── RELATIONSHIPS ({len(rel_lines)}) ──")
        lines.extend(rel_lines)

    return "\n".join(lines)


async def tool_save_classification(ctx: AgentToolsContext, table_fqn: str, model_json: str) -> str:
    """Save the semantic classification for a table to the catalog.

    table_fqn: alias.schema.table (e.g. src0.public.orders)
    model_json: JSON string — see schema below.

    Schema:
    {
      "database_name": "string",
      "schema_name": "string",
      "table_name": "string",
      "table_type": "fact | dimension | bridge | unknown",
      "description": "One sentence describing what this table represents",
      "grain": "What one row represents (e.g. 'one order')",
      "entities": [{"name": "...", "entity_type": "primary | foreign", "column_name": "...", "description": "..."}],
      "dimensions": [{"name": "...", "dim_type": "categorical | time", "column_name": "...", "description": "...", "time_granularity": "day | week | month | year | null"}],
      "measures": [{"name": "...", "agg": "count | sum | avg | min | max | count_distinct", "expr": "...", "description": "..."}]
    }
    """
    from storage.repositories import JobRepository, SemanticRepository

    try:
        data = json.loads(model_json) if isinstance(model_json, str) else model_json
        model = _parse_semantic_model(data, table_fqn)

        async with ctx.session_factory() as s:
            await SemanticRepository(s).save_model(ctx.job_id, model)

        ctx.semantic_models_saved.append(model)
        ctx.tables_saved += 1

        # Update job progress — each save commits independently
        try:
            async with ctx.session_factory() as s2:
                await JobRepository(s2, ctx.tenant_id).update_progress(
                    ctx.job_id, ctx.tables_total, ctx.tables_saved
                )
        except Exception as prog_exc:
            logger.debug("Progress update skipped: %s", prog_exc)

        # Generate and store embedding (best-effort, never blocks classification)
        try:
            from embeddings.service import EmbeddingService
            from storage.repositories import EmbeddingRepository, SettingsRepository

            async with ctx.session_factory() as s3:
                api_key, emb_model = await SettingsRepository(
                    s3, ctx.tenant_id
                ).get_embedding_config()

            if api_key:
                emb_text = _build_embedding_text(model)
                svc = EmbeddingService(api_key=api_key)
                vector = await svc.embed(emb_text)
                if vector:
                    async with ctx.session_factory() as s4:
                        await EmbeddingRepository(s4, ctx.tenant_id).upsert(
                            job_id=ctx.job_id,
                            schema_name=model.schema_name,
                            table_name=model.table_name,
                            embedding=vector,
                            text_content=emb_text,
                            model=emb_model or "text-embedding-3-small",
                        )
                    logger.debug(
                        "[Job %s] Embedded: %s.%s", ctx.job_id, model.schema_name, model.table_name
                    )
        except Exception as emb_exc:
            logger.warning("[Job %s] Embedding skipped for %s: %s", ctx.job_id, table_fqn, emb_exc)

        logger.info(
            "[Job %s] Saved classification: %s (%s) — %d/%d",
            ctx.job_id,
            model.table_name,
            model.table_type,
            ctx.tables_saved,
            ctx.tables_total,
        )
        return (
            f"Saved: {model.table_name} [{model.table_type}] "
            f"({ctx.tables_saved}/{ctx.tables_total if ctx.tables_total else '?'})"
        )
    except Exception as exc:
        logger.warning("[Job %s] save_classification failed for %s: %s", ctx.job_id, table_fqn, exc)
        return f"Error saving classification for {table_fqn}: {exc}"


async def tool_save_relationships(ctx: AgentToolsContext, relationships_json: str) -> str:
    """Save detected relationships (FK constraints + inferred) to the catalog.

    relationships_json: JSON array of relationship objects.

    Schema per item:
    {
      "from_schema": "public",
      "from_table": "orders",
      "from_column": "customer_id",
      "to_schema": "public",
      "to_table": "customers",
      "to_column": "id",
      "confidence": 1.0,
      "source": "explicit | inferred"
    }
    """
    from storage.repositories import RelationshipRepository

    try:
        data = (
            json.loads(relationships_json)
            if isinstance(relationships_json, str)
            else relationships_json
        )
        if not isinstance(data, list):
            data = [data]

        rels: list[Relationship] = []
        for r in data:
            try:
                rels.append(
                    Relationship(
                        from_database=r.get("from_database", ""),
                        from_schema=r.get("from_schema", ""),
                        from_table=r["from_table"],
                        from_column=r["from_column"],
                        to_database=r.get("to_database", ""),
                        to_schema=r.get("to_schema", ""),
                        to_table=r["to_table"],
                        to_column=r["to_column"],
                        confidence=float(r.get("confidence", 1.0)),
                        source=RelationshipSource(r.get("source", "inferred")),
                    )
                )
            except Exception as exc:
                logger.warning("[Job %s] Skipping malformed relationship: %s", ctx.job_id, exc)

        if rels:
            async with ctx.session_factory() as s:
                await RelationshipRepository(s).save_many(ctx.job_id, rels)
            ctx.relationships_saved.extend(rels)

        return f"Saved {len(rels)} relationship(s)."
    except Exception as exc:
        logger.warning("[Job %s] save_relationships failed: %s", ctx.job_id, exc)
        return f"Error saving relationships: {exc}"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_primary_db(ctx: AgentToolsContext) -> str:
    """Return the first alias — in DuckDB the alias IS the catalog database name."""
    return next(iter(ctx.alias_map.values()), "")


def _parse_semantic_model(data: dict, table_fqn: str) -> SemanticModel:
    """Parse LLM JSON output into a typed SemanticModel."""
    parts = table_fqn.split(".")
    db = parts[0] if len(parts) >= 3 else data.get("database_name", "")
    schema = parts[1] if len(parts) >= 3 else data.get("schema_name", "")
    table = parts[2] if len(parts) >= 3 else data.get("table_name", parts[-1])

    entities = [
        Entity(
            name=e.get("name", e.get("column_name", "")),
            entity_type=EntityType(e.get("entity_type", "primary")),
            column_name=e.get("column_name", ""),
            description=e.get("description", ""),
        )
        for e in data.get("entities", [])
    ]

    dimensions = [
        Dimension(
            name=d.get("name", d.get("column_name", "")),
            dim_type=DimensionType(d.get("dim_type", "categorical")),
            column_name=d.get("column_name", ""),
            description=d.get("description", ""),
            time_granularity=d.get("time_granularity") or None,
        )
        for d in data.get("dimensions", [])
    ]

    measures = []
    for m in data.get("measures", []):
        try:
            agg = MeasureAgg(m.get("agg", "count"))
        except ValueError:
            agg = MeasureAgg.COUNT
        measures.append(
            Measure(
                name=m.get("name", m.get("expr", "")),
                agg=agg,
                expr=m.get("expr", ""),
                description=m.get("description", ""),
            )
        )

    return SemanticModel(
        database_name=data.get("database_name", db),
        schema_name=data.get("schema_name", schema),
        table_name=data.get("table_name", table),
        description=data.get("description", ""),
        table_type=data.get("table_type", "unknown"),
        grain=data.get("grain", ""),
        entities=entities,
        dimensions=dimensions,
        measures=measures,
    )


# ---------------------------------------------------------------------------
# Chart & Dashboard creation tools (analyst agent)
# ---------------------------------------------------------------------------

VALID_CHART_TYPES = {"bar", "line", "area", "pie", "donut", "kpi", "table"}


async def tool_create_chart(
    ctx: AgentToolsContext,
    sql: str,
    name: str,
    chart_type: str,
    x_column: str,
    y_columns: str,
    description: str = "",
) -> str:
    """Create a dataset (SQL query) and a chart from it, persisted to the catalog.

    Returns JSON with chart_id, dataset_id, and the URL to view the chart.
    """
    from storage.repositories.charts_repo import ChartRepository, DatasetRepository

    chart_type = chart_type.lower().strip()
    if chart_type not in VALID_CHART_TYPES:
        return json.dumps(
            {
                "error": f"Invalid chart_type '{chart_type}'. Must be one of: {', '.join(sorted(VALID_CHART_TYPES))}"
            }
        )

    job_id = ctx.job_id
    if not job_id:
        # Global mode — pick first available job
        job_id = next(iter(ctx.alias_map.keys()), "")
    if not job_id:
        return json.dumps(
            {"error": "No database job context available. Please connect a database first."}
        )

    # Parse y_columns (comma-separated string or already a list)
    if isinstance(y_columns, str):
        y_cols = [c.strip() for c in y_columns.split(",") if c.strip()]
    else:
        y_cols = list(y_columns)

    config: dict = {
        "x_column": x_column,
        "y_columns": y_cols,
        "show_grid": True,
        "show_legend": len(y_cols) > 1,
    }
    # For pie/donut, remap to label/value convention
    if chart_type in ("pie", "donut"):
        config = {
            "label_column": x_column,
            "value_column": y_cols[0] if y_cols else "",
            "show_legend": True,
        }
    # For KPI, remap to value_column
    elif chart_type == "kpi":
        config = {
            "value_column": y_cols[0] if y_cols else x_column,
            "label_column": x_column,
        }

    try:
        async with ctx.session_factory() as db:
            dataset_repo = DatasetRepository(db, ctx.tenant_id)
            dataset = await dataset_repo.create(
                job_id=job_id,
                name=name,
                sql=sql,
                description=description,
            )

            chart_repo = ChartRepository(db, ctx.tenant_id)
            chart = await chart_repo.create(
                dataset_id=dataset.id,
                name=name,
                chart_type=chart_type,
                config=config,
                description=description,
            )

        logger.info("[Agent] Created chart '%s' (id=%s) for job %s", name, chart.id, job_id[:8])

        # ── Capture snapshot into Redis while DuckDB is already warm ─────────
        try:
            from datetime import datetime

            from storage import snapshot_cache

            loop = asyncio.get_running_loop()
            rows = await loop.run_in_executor(ctx.engine.executor, ctx.engine.execute_raw, sql)
            columns = list(rows[0].keys()) if rows else []
            await snapshot_cache.set(
                chart.id,
                columns,
                rows,
                cached_at=datetime.now(UTC).isoformat(),
            )
            logger.info(
                "[Agent] Snapshot written to Redis for chart %s (%d rows)", chart.id, len(rows)
            )
        except Exception as snap_exc:
            logger.warning("[Agent] Snapshot skipped for chart %s: %s", chart.id, snap_exc)
        # ── End snapshot ──────────────────────────────────────────────────────

        return json.dumps(
            {
                "chart_id": chart.id,
                "chart_name": chart.name,
                "dataset_id": dataset.id,
                "chart_type": chart_type,
                "url": f"/charts/{chart.id}",
                "message": f"Chart '{name}' created successfully.",
            }
        )
    except Exception as exc:
        logger.warning("[Agent] create_chart failed: %s", exc)
        return json.dumps({"error": str(exc)})


async def tool_list_charts(ctx: AgentToolsContext) -> str:
    """List all saved charts with their IDs, names, types, and URLs."""
    from storage.repositories.charts_repo import ChartRepository

    try:
        async with ctx.session_factory() as db:
            charts = await ChartRepository(db, ctx.tenant_id).list()

        if not charts:
            return json.dumps({"charts": [], "message": "No charts have been saved yet."})

        return json.dumps(
            {
                "charts": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "chart_type": c.chart_type,
                        "dataset_id": c.dataset_id,
                        "url": f"/charts/{c.id}",
                    }
                    for c in charts
                ]
            }
        )
    except Exception as exc:
        logger.warning("[Agent] list_charts failed: %s", exc)
        return json.dumps({"error": str(exc)})


async def tool_list_dashboards(ctx: AgentToolsContext) -> str:
    """List all saved dashboards with their IDs and names."""
    from storage.repositories.charts_repo import DashboardRepository

    try:
        async with ctx.session_factory() as db:
            dashboards = await DashboardRepository(db, ctx.tenant_id).list()

        if not dashboards:
            return json.dumps({"dashboards": [], "message": "No dashboards exist yet."})

        return json.dumps(
            {
                "dashboards": [
                    {"id": d.id, "name": d.name, "description": d.description or ""}
                    for d in dashboards
                ]
            }
        )
    except Exception as exc:
        logger.warning("[Agent] list_dashboards failed: %s", exc)
        return json.dumps({"error": str(exc)})


async def tool_find_similar_dashboards(ctx: AgentToolsContext, query: str) -> str:
    """Find existing dashboards whose names are semantically similar to the user's request."""
    from storage.repositories.charts_repo import DashboardRepository

    try:
        async with ctx.session_factory() as db:
            matches = await DashboardRepository(db, ctx.tenant_id).find_similar(
                query, threshold=0.30
            )

        if not matches:
            return json.dumps(
                {
                    "similar_dashboards": [],
                    "message": "No similar dashboards found. Safe to create a new one.",
                }
            )

        return json.dumps(
            {
                "similar_dashboards": matches,
                "message": (
                    f"Found {len(matches)} existing dashboard(s) similar to your request. "
                    "Ask the user if they want to add to one of these or create a new one."
                ),
            }
        )
    except Exception as exc:
        logger.warning("[Agent] find_similar_dashboards failed: %s", exc)
        return json.dumps({"error": str(exc)})


async def tool_get_dashboard_charts(ctx: AgentToolsContext, dashboard_id: str) -> str:
    """Get all charts currently placed on a specific dashboard."""
    from storage.repositories.charts_repo import DashboardRepository

    try:
        async with ctx.session_factory() as db:
            dashboard = await DashboardRepository(db, ctx.tenant_id).get_with_charts(dashboard_id)

        if not dashboard:
            return json.dumps({"error": f"Dashboard '{dashboard_id}' not found."})

        charts = [
            {
                "chart_id": dc.chart_id,
                "name": dc.chart.name,
                "chart_type": dc.chart.chart_type,
                "url": f"/charts/{dc.chart_id}",
            }
            for dc in (dashboard.dashboard_charts or [])
        ]
        return json.dumps(
            {
                "dashboard_id": dashboard.id,
                "dashboard_name": dashboard.name,
                "chart_count": len(charts),
                "charts": charts,
            }
        )
    except Exception as exc:
        logger.warning("[Agent] get_dashboard_charts failed: %s", exc)
        return json.dumps({"error": str(exc)})


async def tool_create_dashboard(
    ctx: AgentToolsContext,
    name: str,
    description: str = "",
    force: bool = False,
) -> str:
    """Create a new dashboard and return its ID and URL."""
    from storage.repositories.charts_repo import DashboardRepository

    try:
        async with ctx.session_factory() as db:
            repo = DashboardRepository(db, ctx.tenant_id)

            # Server-side duplicate guard — skip only when user has explicitly confirmed
            if not force:
                matches = await repo.find_similar(name, threshold=0.30)
                if matches:
                    return json.dumps(
                        {
                            "action_required": "confirm_or_reuse",
                            "message": (
                                "Similar dashboards already exist. Before creating a new one, "
                                "ask the user: do they want to add charts to an existing dashboard, "
                                "or create a separate new one?"
                            ),
                            "similar_dashboards": matches,
                        }
                    )

            dashboard = await repo.create(name=name, description=description)

        logger.info("[Agent] Created dashboard '%s' (id=%s)", name, dashboard.id)
        return json.dumps(
            {
                "dashboard_id": dashboard.id,
                "dashboard_name": dashboard.name,
                "url": f"/dashboards/{dashboard.id}",
                "message": f"Dashboard '{name}' created successfully.",
            }
        )
    except Exception as exc:
        logger.warning("[Agent] create_dashboard failed: %s", exc)
        return json.dumps({"error": str(exc)})


# Grid size defaults per chart type (grid_w, grid_h) — mirrors frontend defaultChartSize
_CHART_GRID_SIZE: dict[str, tuple[int, int]] = {
    "kpi": (4, 2),
    "table": (12, 3),
    "pie": (6, 2),
    "donut": (6, 2),
}
_DEFAULT_CHART_GRID_SIZE = (6, 2)


def _next_grid_position(
    existing: list,  # list of DashboardChartORM items
    new_w: int,
) -> tuple[int, int]:
    """Smart column-packing: fill the last row before starting a new one."""
    if not existing:
        return 0, 0

    # Use the highest starting Y (last row) — not the bottom edge — so mixed-height
    # charts in the same row are all counted when computing used columns.
    max_y = max(dc.grid_y for dc in existing)
    last_row = [dc for dc in existing if dc.grid_y == max_y]
    used_cols = sum(dc.grid_w for dc in last_row)

    if used_cols + new_w <= 12:
        return used_cols, max_y

    max_bottom = max(dc.grid_y + dc.grid_h for dc in existing)
    return 0, max_bottom


async def tool_add_chart_to_dashboard(
    ctx: AgentToolsContext,
    dashboard_id: str,
    chart_id: str,
) -> str:
    """Add an existing chart to a dashboard.

    Automatically determines chart size by type and packs into the grid
    (fills the last row before starting a new row, like Metabase/Grafana).
    """
    from storage.repositories.charts_repo import ChartRepository, DashboardRepository

    try:
        async with ctx.session_factory() as db:
            dash_repo = DashboardRepository(db, ctx.tenant_id)

            # Verify dashboard exists
            dashboard = await dash_repo.get(dashboard_id)
            if not dashboard:
                return json.dumps({"error": f"Dashboard '{dashboard_id}' not found."})

            # Look up chart type for smart sizing
            chart_orm = await ChartRepository(db, ctx.tenant_id).get(chart_id)
            chart_type = chart_orm.chart_type if chart_orm else "bar"
            grid_w, grid_h = _CHART_GRID_SIZE.get(chart_type, _DEFAULT_CHART_GRID_SIZE)

            # Smart packing: use last row if there's room, else start a new row
            dash_with_charts = await dash_repo.get_with_charts(dashboard_id)
            existing = dash_with_charts.dashboard_charts if dash_with_charts else []
            next_x, next_y = _next_grid_position(existing, grid_w)

            await dash_repo.add_chart(
                dashboard_id=dashboard_id,
                chart_id=chart_id,
                grid_x=next_x,
                grid_y=next_y,
                grid_w=grid_w,
                grid_h=grid_h,
            )

        logger.info("[Agent] Added chart %s to dashboard %s", chart_id[:8], dashboard_id[:8])
        return json.dumps(
            {
                "dashboard_id": dashboard_id,
                "chart_id": chart_id,
                "url": f"/dashboards/{dashboard_id}",
                "message": f"Chart added to dashboard '{dashboard.name}' successfully.",
            }
        )
    except Exception as exc:
        logger.warning("[Agent] add_chart_to_dashboard failed: %s", exc)
        return json.dumps({"error": str(exc)})


# ---------------------------------------------------------------------------
# v2: Dataset reuse tool (long-term memory)
# ---------------------------------------------------------------------------


async def tool_find_existing_dataset(ctx: AgentToolsContext, question: str) -> str:
    """Search long-term memory for a dataset that already answers a similar question.

    Called by the Supervisor before routing to analyst_agent. If a high-similarity
    match (score > 0.75) is found, the dataset can be returned directly without
    delegating — dramatically reducing latency on repeated or similar queries.

    Args:
        ctx:      shared agent context (tenant_id used for scoping)
        question: the user's natural language question

    Returns:
        JSON string with:
          match=True  → dataset_id, description, similarity_score, dataset_url
          match=False → reason message
    """
    try:
        from embeddings.service import EmbeddingService
        from storage.repositories.settings_repo import SettingsRepository

        async with ctx.session_factory() as _s:
            api_key, _ = await SettingsRepository(_s, ctx.tenant_id).get_embedding_config()

        if not api_key:
            return json.dumps({"match": False, "reason": "No embedding API key configured"})

        # Generate embedding for the question
        embedding_service = EmbeddingService(api_key=api_key)
        embedding = await embedding_service.embed(question)
        if not embedding:
            return json.dumps(
                {"match": False, "reason": "Could not generate embedding for question"}
            )

        # Search long-term memory
        async with ctx.session_factory() as session:
            from storage.repositories.long_term_repo import LongTermMemoryRepository

            repo = LongTermMemoryRepository(session, ctx.tenant_id)
            matches = await repo.find_similar(embedding, top_k=3)

        if not matches:
            return json.dumps({"match": False, "reason": "No similar datasets found in memory"})

        best = matches[0]
        score = best.get("similarity_score", 0)

        # Threshold: only reuse if similarity is high enough (0.70+)
        if score < 0.70:
            return json.dumps(
                {
                    "match": False,
                    "reason": f"Best match score {score:.2f} below threshold (0.70)",
                    "closest": best.get("description", ""),
                }
            )

        # Record the access to update popularity score
        async with ctx.session_factory() as session:
            from storage.repositories.long_term_repo import LongTermMemoryRepository

            repo = LongTermMemoryRepository(session, ctx.tenant_id)
            await repo.record_access(best["id"])

        return json.dumps(
            {
                "match": True,
                "dataset_id": best["dataset_id"],
                "description": best["description"],
                "tables_used": best.get("tables_used", []),
                "similarity_score": round(score, 3),
                "times_accessed": best.get("times_accessed", 0),
                "dataset_url": f"/datasets/{best['dataset_id']}",
                "message": f"Found existing dataset with {score:.0%} similarity to your question.",
            }
        )

    except Exception as exc:
        logger.warning("[Agent] tool_find_existing_dataset failed: %s", exc)
        return json.dumps({"match": False, "reason": f"Memory search error: {exc}"})
