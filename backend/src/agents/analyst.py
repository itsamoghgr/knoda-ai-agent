"""Analyst sub-agent — answers data questions using the pre-built semantic catalog
and, when needed, executing SQL against the live database.

Tool hierarchy (semantic-first):
  1. get_semantic_catalog  — always first; reads pre-built knowledge from PostgreSQL
  2. search_tables         — targeted semantic search for SQL construction
  3. describe_table        — raw column details when writing SQL
  4. get_relationships     — join paths (also included in catalog, but useful standalone)
  5. execute_sql           — hit the live database ONLY when actual data is needed
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from agents.core import (
    AgentToolsContext,
    tool_add_chart_to_dashboard,
    tool_create_chart,
    tool_create_dashboard,
    tool_describe_table,
    tool_execute_sql,
    tool_find_similar_dashboards,
    tool_get_dashboard_charts,
    tool_get_relationships,
    tool_get_semantic_catalog,
    tool_list_charts,
    tool_list_databases,
    tool_list_dashboards,
    tool_search_tables,
)

logger = logging.getLogger(__name__)

ANALYST_PROMPT = """You are an expert data analyst agent for Knoda.ai. You have access to a
pre-built semantic catalog produced by a discovery agent, plus the ability to query live databases.

## Core principle: semantic catalog first, live database last

The semantic catalog already contains everything discovered about the database — table descriptions,
types, grain, key columns, measures, and relationships. You MUST read it before doing anything else.
Touching the live database (execute_sql, describe_table) is only necessary when the user wants
ACTUAL DATA, not schema knowledge.

## Workflow

### For schema / structure / relationship questions
  ("What tables exist?", "How are tables related?", "What does the orders table store?")
  1. get_semantic_catalog()   ← one call gives you the full picture
  2. get_relationships()      ← only if you need the detailed join paths
  3. Answer directly from the catalog — do NOT call search_tables or execute_sql

### For data / analytical questions
  ("How many orders last month?", "Top 10 customers by revenue?")
  1. get_semantic_catalog()   ← understand what tables/columns are available
  2. search_tables(<topic>)   ← narrow down the most relevant tables if schema is large
  3. describe_table(<fqn>)    ← get exact column names needed for SQL
  4. execute_sql(<sql>)       ← run the query; present results as a markdown table

## SQL Writing Guide

**Always qualify table names with the alias (shown in the catalog): alias.schema.table**

JOINs — explicit JOIN ... ON:
  SELECT c.name, SUM(o.total_amount) AS revenue
  FROM src0.public.orders o
  JOIN src0.public.users c ON o.user_id = c.id
  GROUP BY c.name ORDER BY revenue DESC LIMIT 10

CTEs — use WITH for multi-step logic:
  WITH monthly AS (
    SELECT DATE_TRUNC('month', created_at) AS month, SUM(amount) AS total
    FROM src0.public.orders GROUP BY 1
  )
  SELECT * FROM monthly ORDER BY month

Window functions:
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC)
  SUM(amount) OVER (ORDER BY created_at ROWS UNBOUNDED PRECEDING)

DuckDB specifics: DATE_TRUNC('month', col), strftime('%b %Y', col) for date labels, STRING_AGG(col, ', '), EPOCH_MS(col)
Never use TO_CHAR() — it is a PostgreSQL function not available in DuckDB.

### For chart / dashboard creation requests
  ("Create a bar chart of orders by status", "Build a revenue dashboard")
  1. get_semantic_catalog()        ← understand available tables and columns
  2. execute_sql(<sql>)            ← verify the query works and inspect column names
  3. create_chart(sql, name, chart_type, x_column, y_columns)
     ← creates a persistent chart; returns chart_id and a /charts/{id} URL

### Dashboard deduplication — REQUIRED before creating any dashboard

  ALWAYS call find_similar_dashboards(query) before create_dashboard.
  Use the user's original request as the query (e.g. "revenue dashboard for CEO").

  **If find_similar_dashboards returns matches:**
    - Do NOT call create_dashboard immediately
    - Present the similar dashboards to the user in a short list, e.g.:
        "I found a similar dashboard already: **CEO Revenue Dashboard 2025** — [View it →](/dashboards/abc123)
         Would you like to:
         (A) Add your new chart(s) to this existing dashboard
         (B) Create a separate new dashboard"
    - Wait for the user's reply before proceeding
    - If user picks (A): call add_chart_to_dashboard(existing_id, chart_id)
    - If user picks (B): call create_dashboard(name, force=True) to bypass the duplicate check

  **If find_similar_dashboards returns no matches:**
    - Proceed with create_dashboard(name) — no similar dashboards exist

**Listing existing charts/dashboards**:
- "What charts do we have?" / "Show me saved charts" → call list_charts()
- "What dashboards exist?" → call list_dashboards()
- "What's on the Sales Dashboard?" / "What charts are in dashboard X?" → call list_dashboards() to find the ID, then get_dashboard_charts(dashboard_id)
- Before adding a chart to a dashboard, call get_dashboard_charts(dashboard_id) to avoid duplicates
- NEVER use get_semantic_catalog() to answer these questions — it knows nothing about saved charts/dashboards

**Chart types**: bar, line, area, pie, donut, kpi, table
- bar/line/area: x_column = category or time, y_columns = one or more metrics (comma-separated)
- pie/donut: x_column = label/category, y_columns = single value metric
- kpi: y_columns = single numeric metric column
- table: x_column and y_columns are ignored; all columns are shown

Always end chart creation with a markdown link:
  "Chart created! [View Orders by Status →](/charts/abc123)"
  "Added to dashboard! [View Sales Overview →](/dashboards/xyz789)"

## Rules

- NEVER call search_tables or execute_sql to answer schema/structure questions — use the catalog
- ALWAYS qualify table names: alias.schema.table
- ALWAYS run a query for data questions — never guess values
- If a query returns 0 rows or unexpected results, investigate with a follow-up query
- Be concise and direct — no "Great question!" or "In conclusion..." filler
- Present multi-row query results as a markdown table
- After creating a chart or dashboard, ALWAYS include the markdown link so the user can navigate to it
"""


def build_analyst_agent(
    llm: Any,
    ctx: AgentToolsContext,
    business_context: str | None = None,
    extra_system_prompt: str | None = None,
):
    """Build a LangGraph ReAct agent with semantic-first analyst tools.

    extra_system_prompt — prepended before everything else (used for
    presentation mode instructions that must take priority over all other context).
    """
    prompt = ANALYST_PROMPT

    # Business context goes between extra instructions and the core analyst prompt
    if business_context and business_context.strip():
        prompt = f"## About This Business\n{business_context.strip()}\n\n" + prompt

    # Extra instructions (e.g. presentation mode) take highest priority — prepend last
    if extra_system_prompt and extra_system_prompt.strip():
        prompt = extra_system_prompt.strip() + "\n\n" + prompt

    @tool
    async def get_semantic_catalog() -> str:
        """Load the complete pre-built semantic catalog for this database.

        Returns ALL tables with descriptions, types (fact/dimension/bridge),
        grain, key columns, dimensions, measures, and relationships.

        Call this FIRST for any question — schema, relationships, or data.
        This reads from pre-computed knowledge (zero live DB calls).
        """
        return await tool_get_semantic_catalog(ctx)

    @tool
    async def list_databases() -> str:
        """List all connected databases with their aliases.

        Useful when you need to verify the exact alias prefix for SQL queries.
        """
        return await tool_list_databases(ctx)

    @tool
    async def search_tables(query: str) -> str:
        """Search for tables most relevant to a specific data topic.

        query: describe what data you need (e.g. "customer orders with revenue").
        Use this when the schema is large and you want to narrow down which tables
        to use before writing SQL. Not needed for schema/structure questions —
        use get_semantic_catalog() for those.
        """
        return await tool_search_tables(ctx, query)

    @tool
    async def describe_table(table_fqn: str) -> str:
        """Get the full raw column schema for a table.

        table_fqn format: alias.schema.table (e.g. src0.public.orders)
        Returns all column names, types, nullable flags, PK and FK references.
        Call this when you need exact column names to write SQL.
        """
        return await tool_describe_table(ctx, table_fqn)

    @tool
    async def get_relationships() -> str:
        """Get all FK and inferred relationships as explicit join paths.

        Returns: alias.schema.table.col → alias.schema.table.col
        The semantic catalog already includes a relationship summary, but call
        this when you need the full list of join paths for complex SQL.
        """
        return await tool_get_relationships(ctx)

    @tool
    async def execute_sql(sql: str) -> str:
        """Execute a read-only SQL SELECT query against the connected database.

        Always qualify table names with alias.schema.table.
        Returns up to 100 rows. Use JOINs, CTEs, and window functions as needed.
        Only call this when the user needs actual data — not for schema questions.
        """
        return await tool_execute_sql(ctx, sql)

    @tool
    async def create_chart(
        sql: str,
        name: str,
        chart_type: str,
        x_column: str,
        y_columns: str,
        description: str = "",
    ) -> str:
        """Create a chart from a SQL query and save it to the catalog.

        sql: a validated SELECT query (call execute_sql first to confirm it works)
        name: human-readable chart title
        chart_type: one of bar | line | area | pie | donut | kpi | table
        x_column: category or time axis column (label column for pie/donut)
        y_columns: comma-separated metric column names (e.g. "total_revenue,order_count")
        description: optional description

        Returns JSON with chart_id, dataset_id, and /charts/{id} URL.
        Always show the user the URL as a markdown link after creation.
        """
        return await tool_create_chart(ctx, sql, name, chart_type, x_column, y_columns, description)

    @tool
    async def list_charts() -> str:
        """List all charts that have already been saved in the catalog.

        Call this when the user asks "what charts do we have?", "show me existing charts",
        or wants to know which charts exist before adding one to a dashboard.
        Returns chart IDs, names, types, and /charts/{id} URLs.
        """
        return await tool_list_charts(ctx)

    @tool
    async def list_dashboards() -> str:
        """List all saved dashboards with their IDs and names.

        Call this before add_chart_to_dashboard to find the correct dashboard_id.
        """
        return await tool_list_dashboards(ctx)

    @tool
    async def find_similar_dashboards(query: str) -> str:
        """Search for existing dashboards that are semantically similar to the user's request.

        query: the user's dashboard request in natural language
               (e.g. "revenue dashboard for CEO", "sales overview")

        Call this BEFORE create_dashboard whenever the user asks to 'create',
        'build', or 'make' a dashboard. If similar dashboards are found, present
        them to the user and ask whether to reuse one or create a new one.
        """
        return await tool_find_similar_dashboards(ctx, query)

    @tool
    async def create_dashboard(name: str, description: str = "", force: bool = False) -> str:
        """Create a new empty dashboard.

        Before calling this, call find_similar_dashboards(query) to check if a
        similar dashboard already exists. Only call create_dashboard after
        confirming with the user that they want a new one.

        force=True: skip duplicate detection (use only after user explicitly
        says "create a new one" or "yes, create it anyway").

        Returns JSON with dashboard_id and /dashboards/{id} URL.
        Always show the user the URL as a markdown link after creation.
        """
        return await tool_create_dashboard(ctx, name, description, force=force)

    @tool
    async def get_dashboard_charts(dashboard_id: str) -> str:
        """Get all charts currently placed on a specific dashboard.

        dashboard_id: ID from list_dashboards() or create_dashboard()

        Call this when the user asks "what's on my dashboard?", "what charts are in X?",
        or before adding charts to check for duplicates.
        Returns chart names, types, and URLs.
        """
        return await tool_get_dashboard_charts(ctx, dashboard_id)

    @tool
    async def add_chart_to_dashboard(dashboard_id: str, chart_id: str) -> str:
        """Add an existing chart to a dashboard.

        dashboard_id: ID from list_dashboards() or create_dashboard()
        chart_id: ID from create_chart()

        The chart is placed full-width at the next available row.
        Returns JSON with the dashboard URL.
        """
        return await tool_add_chart_to_dashboard(ctx, dashboard_id, chart_id)

    tools = [
        get_semantic_catalog,
        list_databases,
        search_tables,
        describe_table,
        get_relationships,
        execute_sql,
        create_chart,
        list_charts,
        list_dashboards,
        find_similar_dashboards,
        create_dashboard,
        get_dashboard_charts,
        add_chart_to_dashboard,
    ]

    return create_react_agent(
        llm,
        tools=tools,
        prompt=prompt,
        checkpointer=None,
    )
