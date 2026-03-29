"""Communication Agent — live meeting presenter.

A full ReAct agent (Think → Act → Observe loop) that autonomously discovers
what is on the dashboard via tools, then narrates or answers questions.
Nothing is pre-injected — all context is fetched through tool calls.

Tool set (data/read only — no chart or dashboard creation):
  - get_dashboard_charts   discover what charts are on the current dashboard
  - get_semantic_catalog   schema knowledge base
  - list_databases         DB aliases for SQL
  - search_tables          semantic search for relevant tables
  - describe_table         exact column names for SQL construction
  - get_relationships      join paths between tables
  - execute_sql            live data queries
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from agents.core import (
    AgentToolsContext,
    tool_describe_table,
    tool_execute_sql,
    tool_get_dashboard_charts,
    tool_get_relationships,
    tool_get_semantic_catalog,
    tool_list_databases,
    tool_search_tables,
)

logger = logging.getLogger(__name__)

COMMUNICATION_PROMPT = """\
You are a live AI data presenter in a business meeting. You are presenting dashboard_id="{dashboard_id}".

## Your behavior

When the message asks you to begin or start the presentation:
  1. Call get_dashboard_charts("{dashboard_id}") to discover what charts the audience can see
  2. Optionally call get_semantic_catalog() if you need deeper schema context for insights
  3. Give a natural spoken opening — welcome the audience briefly, introduce the dashboard,
     walk through each chart by name, call out the single most important insight for each,
     then close with a brief summary or call to action
  4. Use double line breaks between each section so audio can start playing immediately

When you receive a QUESTION from the audience:
  1. Think: can I answer from context I already have, or do I need fresh data?
  2. If fresh data is needed: call execute_sql() — or search_tables() first if unsure of table names
  3. Answer conversationally and directly — speak the insight, not the process

## Absolute rules (no exceptions)
  - Plain spoken English ONLY — no markdown, no bullet points, no headers, no code blocks
  - Never output SQL in your response — run it with execute_sql(), then speak the finding
  - Never say "I will call..." or "I am now querying..." — just give the answer
  - If asked which dashboard is on screen: answer from get_dashboard_charts("{dashboard_id}") result
  - You are a presenter, not a builder — do not create charts or dashboards
"""


def build_communication_agent(
    llm: Any,
    ctx: AgentToolsContext,
    dashboard_id: str,
):
    """Build a ReAct Communication Agent for live meeting presentations.

    The agent discovers dashboard context autonomously via tools on every call.
    Session history (passed as prior messages) provides conversational memory.
    """
    prompt = COMMUNICATION_PROMPT.format(dashboard_id=dashboard_id)

    @tool
    async def get_dashboard_charts(dashboard_id: str) -> str:  # noqa: F811
        """Get all charts currently placed on a specific dashboard.

        dashboard_id: the ID of the dashboard being presented

        Call this first during a presentation to discover what charts
        the audience can see. Returns chart names, types, and IDs.
        """
        return await tool_get_dashboard_charts(ctx, dashboard_id)

    @tool
    async def get_semantic_catalog() -> str:
        """Load the pre-built semantic catalog — table descriptions, columns, measures, relationships.

        Call this when you need schema understanding to interpret chart data or write SQL.
        This reads from pre-computed knowledge (zero live DB calls).
        """
        return await tool_get_semantic_catalog(ctx)

    @tool
    async def list_databases() -> str:
        """List all connected databases with their aliases.

        Use when you need to know the alias prefix (e.g. src0) for SQL queries.
        """
        return await tool_list_databases(ctx)

    @tool
    async def search_tables(query: str) -> str:
        """Find tables most relevant to a specific data topic.

        query: describe what data you need (e.g. "monthly revenue by product")
        Use before execute_sql when you need to narrow down the most relevant tables.
        """
        return await tool_search_tables(ctx, query)

    @tool
    async def describe_table(table_fqn: str) -> str:
        """Get full column details for a table.

        table_fqn format: alias.schema.table (e.g. src0.public.orders)
        Use when you need exact column names to write SQL.
        """
        return await tool_describe_table(ctx, table_fqn)

    @tool
    async def get_relationships() -> str:
        """Get all FK and inferred join paths between tables.

        Use when writing JOIN queries to know how tables connect.
        """
        return await tool_get_relationships(ctx)

    @tool
    async def execute_sql(sql: str) -> str:
        """Execute a read-only SQL SELECT query to get live data.

        Always qualify table names: alias.schema.table (e.g. src0.public.orders)
        Only call this when actual data values are needed — not for schema questions.
        """
        return await tool_execute_sql(ctx, sql)

    tools = [
        get_dashboard_charts,
        get_semantic_catalog,
        list_databases,
        search_tables,
        describe_table,
        get_relationships,
        execute_sql,
    ]

    return create_react_agent(llm, tools=tools, prompt=prompt, checkpointer=None)
