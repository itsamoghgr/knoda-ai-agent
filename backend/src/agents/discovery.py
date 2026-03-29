"""Discovery sub-agent — systematically catalogs every table in a database.

Tools: explore_schema, describe_table, execute_sql (read-only),
       save_classification, save_relationships.

The agent is exhaustive: it must classify EVERY table before finishing.
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
    tool_explore_schema,
    tool_save_classification,
    tool_save_relationships,
)

logger = logging.getLogger(__name__)

DISCOVERY_PROMPT = """You are a database discovery agent. Your mission is to systematically
explore and catalog EVERY table in the connected database.

## Workflow

1. Call explore_schema() to list all schemas and tables.
2. For each table, call describe_table(<alias>.<schema>.<table>) to get its columns,
   types, PKs and FK references.
3. Call execute_sql() ONLY when you genuinely need data evidence to resolve ambiguity —
   e.g. checking distinct values of a status column, or verifying a suspected relationship.
   Do NOT use it just to list tables or columns.
4. Call save_classification(<alias>.<schema>.<table>, <json>) for EVERY table.
   Do not skip any table, even if it seems like a system or utility table.
5. After ALL tables are saved, call save_relationships(<json>) ONCE with all detected
   FK constraints and inferred relationships.

## Classification rules

- fact: has a PK, multiple FK columns pointing to dimension tables, numeric measure
  columns (amounts, totals, counts, prices). Examples: orders, transactions, events.
- dimension: has a PK, mostly descriptive/categorical attributes, referenced by fact
  tables. Low row count relative to fact tables. Examples: customers, products, users.
- bridge: mostly FK columns, little descriptive data, represents a many-to-many join.
  Examples: order_items, user_roles, product_categories.
- unknown: use when genuinely unsure.

## save_classification JSON format

{
  "database_name": "<database>",
  "schema_name": "<schema>",
  "table_name": "<table>",
  "table_type": "fact | dimension | bridge | unknown",
  "description": "One sentence describing what this table represents.",
  "grain": "What one row represents (e.g. 'one customer order')",
  "entities": [
    {"name": "...", "entity_type": "primary | foreign", "column_name": "...", "description": "..."}
  ],
  "dimensions": [
    {"name": "...", "dim_type": "categorical | time", "column_name": "...",
     "description": "...", "time_granularity": "day | week | month | year | null"}
  ],
  "measures": [
    {"name": "...", "agg": "count | sum | avg | min | max | count_distinct",
     "expr": "<column_name>", "description": "..."}
  ]
}

## Column classification guide

- entity (primary): PK column — id, <table>_id, high cardinality, 0% nulls
- entity (foreign): FK column — ends in _id, _key, _fk, _ref
- dimension (categorical): VARCHAR/text, limited distinct values — status, type, country
- dimension (time): timestamp/date, or name contains _at, _date, _time, created, updated
- measure (sum): numeric — amount, revenue, price, cost, total, value, salary
- measure (count): integer counting things — quantity, count, num_
- measure (avg): rate, ratio, score, pct, avg, mean

## save_relationships JSON format

[
  {
    "from_schema": "public",
    "from_table": "orders",
    "from_column": "customer_id",
    "to_schema": "public",
    "to_table": "customers",
    "to_column": "id",
    "confidence": 1.0,
    "source": "explicit"
  }
]

Use source="explicit" for FK constraints declared in the schema.
Use source="inferred" (confidence 0.7-0.9) for relationships you deduced from column names.

## Important

Be exhaustive — every table must have a saved classification.
Analyse multiple tables before saving if it helps you understand cross-table relationships.
"""


def build_discovery_agent(llm: Any, ctx: AgentToolsContext):
    """Build a LangGraph ReAct agent with discovery-focused tools."""

    @tool
    async def explore_schema(database_alias: str | None = None) -> str:
        """List all schemas and tables in the connected database.

        Returns table names, column counts, and row estimates.
        Call this first to get a complete picture before describing individual tables.
        """
        return await tool_explore_schema(ctx, database_alias)

    @tool
    async def describe_table(table_fqn: str) -> str:
        """Get the full column schema for a specific table.

        table_fqn format: alias.schema.table (e.g. src0.public.orders)
        Returns column names, types, nullable flags, PK and FK markers.
        """
        return await tool_describe_table(ctx, table_fqn)

    @tool
    async def execute_sql(sql: str) -> str:
        """Execute a read-only SQL SELECT query.

        Use ONLY when you need data evidence to resolve ambiguity — e.g. checking
        distinct values of an ambiguous column, or verifying a suspected FK relationship
        by sampling matching IDs. Results are capped at 100 rows.
        """
        return await tool_execute_sql(ctx, sql)

    @tool
    async def save_classification(table_fqn: str, model_json: str) -> str:
        """Save the semantic classification for a table.

        table_fqn: alias.schema.table (e.g. src0.public.orders)
        model_json: JSON string with table_type, description, grain, entities,
                    dimensions, and measures.
        Call this for EVERY table — do not skip any.
        """
        return await tool_save_classification(ctx, table_fqn, model_json)

    @tool
    async def save_relationships(relationships_json: str) -> str:
        """Save all detected FK and inferred relationships between tables.

        relationships_json: JSON array of relationship objects.
        Call this ONCE after all tables have been classified.
        """
        return await tool_save_relationships(ctx, relationships_json)

    tools = [explore_schema, describe_table, execute_sql, save_classification, save_relationships]
    max_iterations = 200  # generous limit for large databases

    return create_react_agent(
        llm,
        tools=tools,
        prompt=DISCOVERY_PROMPT,
        checkpointer=None,
    ), max_iterations
