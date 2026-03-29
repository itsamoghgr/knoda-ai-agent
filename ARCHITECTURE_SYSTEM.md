# Knoda.ai — Complete System Architecture

> **Living document.** Last updated: 2026-03-25.
> This file describes every major architectural layer — agents, API, query engine, storage, frontend, and deployment — with enough detail to onboard a new engineer or reason about any failure.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Layout](#2-repository-layout)
3. [Request Lifecycle](#3-request-lifecycle)
4. [Backend — FastAPI Application](#4-backend--fastapi-application)
5. [Agent Architecture (LangGraph)](#5-agent-architecture-langgraph)
6. [Query Engine (DuckDB)](#6-query-engine-duckdb)
7. [AI Memory (pgvector)](#7-ai-memory-pgvector)
8. [Storage Layer](#8-storage-layer)
9. [Database Schema](#9-database-schema)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Authentication & Multi-Tenancy](#11-authentication--multi-tenancy)
12. [Environment Variables](#12-environment-variables)
13. [Deployment](#13-deployment)
14. [Data Flow Diagrams](#14-data-flow-diagrams)
15. [Key Design Decisions](#15-key-design-decisions)
16. [Known Constraints & Future Work](#16-known-constraints--future-work)

---

## 1. System Overview

Knoda.ai is an **agentic AI data platform**. It connects to source databases in read-only mode, builds a persistent semantic knowledge graph (AI Memory), answers business data questions in natural language, creates charts and dashboards, and presents insights in live meetings via voice.

### Three-Agent Architecture

```
                          ┌─────────────────────────────────┐
                          │           Supervisor             │
                          │  LLM classifies intent → routes  │
                          └────────────┬────────────────┐────┘
                                       │                │
                          ┌────────────▼───┐    ┌───────▼──────────────┐
                          │  Discovery     │    │  Analyst             │
                          │  Agent         │    │  Agent               │
                          │                │    │                      │
                          │  Catalogs DB   │    │  Answers questions   │
                          │  → AI Memory   │    │  Builds charts       │
                          └────────────────┘    │  Builds dashboards   │
                                                └──────────────────────┘

                          ┌─────────────────────────────────┐
                          │  Communication Agent            │
                          │  (separate invocation path)     │
                          │  Presents dashboards + TTS Q&A  │
                          └─────────────────────────────────┘
```

### Technology Choices at a Glance

| Layer | Technology |
|-------|-----------|
| Agent orchestration | LangGraph (ReAct graphs) |
| LLM | OpenAI / Anthropic / Groq / Ollama (configurable) |
| Query execution | DuckDB (universal, in-memory, read-only) |
| SQL dialect | sqlglot (postgres → duckdb transpilation) |
| Semantic search | pgvector + OpenAI text-embedding-3-small |
| Operational DB | PostgreSQL 16 via SQLAlchemy + asyncpg |
| Backend API | FastAPI + Server-Sent Events |
| Frontend | Next.js 16 (App Router) + React 19 |
| Auth | Supabase Auth (JWT) |
| Infra | DigitalOcean App Platform + Vercel + Supabase |

---

## 2. Repository Layout

```
db_discovery_agent/
├── backend/
│   ├── src/
│   │   ├── agents/               # LangGraph multi-agent layer
│   │   │   ├── agent.py          # Agent factory (entry point)
│   │   │   ├── analyst.py        # Analyst ReAct graph
│   │   │   ├── communication.py  # Communication/presenter ReAct graph
│   │   │   ├── core.py           # AgentToolsContext + all shared tools
│   │   │   ├── discovery.py      # Discovery ReAct graph
│   │   │   ├── state.py          # AgentState TypedDict
│   │   │   └── supervisor.py     # LangGraph supervisor router
│   │   ├── api/
│   │   │   ├── dependencies.py   # FastAPI dependency injection
│   │   │   ├── main.py           # App factory + lifespan
│   │   │   └── routers/          # 11 router modules
│   │   │       ├── agent.py      # POST /agent — unified SSE endpoint
│   │   │       ├── catalog.py
│   │   │       ├── charts.py
│   │   │       ├── dashboards.py
│   │   │       ├── datasets.py
│   │   │       ├── jobs.py
│   │   │       ├── present.py
│   │   │       ├── semantic.py
│   │   │       ├── settings.py
│   │   │       ├── sql_lab.py
│   │   │       └── usage.py
│   │   ├── config.py             # Pydantic BaseSettings (env vars)
│   │   ├── embeddings/
│   │   │   └── service.py        # OpenAI embedding wrapper
│   │   ├── models/               # Pydantic data transfer objects
│   │   │   ├── connection.py     # SourceConfig enum
│   │   │   ├── job.py
│   │   │   ├── profile.py
│   │   │   ├── relationship.py
│   │   │   ├── schema.py         # TableMeta, ColumnMeta
│   │   │   └── semantic.py       # SemanticModel, Entity, Dimension, Measure
│   │   ├── query_engine/
│   │   │   ├── engine.py         # QueryEngine class
│   │   │   └── adapters/
│   │   │       ├── duckdb_file.py
│   │   │       ├── mysql.py
│   │   │       ├── postgres.py
│   │   │       └── s3_parquet.py
│   │   ├── semantic/
│   │   │   └── serializer.py     # dbt MetricFlow YAML serializer
│   │   ├── storage/
│   │   │   ├── database.py       # SQLAlchemy async engine + session factory
│   │   │   ├── source_config_cache.py
│   │   │   ├── orm/              # 9 ORM model files
│   │   │   └── repositories/     # 9 typed repository classes
│   │   └── tools/
│   │       ├── data.py           # execute_sql implementation
│   │       └── schema.py         # explore_schema, describe_table implementations
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/             # 7 migration files (0001–0007)
│   ├── pyproject.toml
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── app/                  # Next.js App Router pages
│   │   ├── components/           # React component tree
│   │   └── lib/                  # API clients, hooks, utilities
│   └── package.json
├── docker/
│   ├── Dockerfile.backend
│   └── docker-compose.yml
├── .do/
│   └── app.yaml                  # DigitalOcean App Platform spec
└── .github/
    └── workflows/ci.yml          # GitHub Actions: ruff lint
```

---

## 3. Request Lifecycle

### A. Discovery Job

```
User submits DB connection
       │
       ▼
POST /api/v1/jobs
  → JobRepository.create(status=pending)
  → asyncio.create_task(run_discovery(...))     ← background task
  → 202 Accepted returned immediately
       │
       ▼ (background)
QueryEngine.attach(source_config)               ← DuckDB ATTACH READ_ONLY
       │
       ▼
build_discovery_agent(llm, ctx)                 ← LangGraph ReAct graph
       │
  ┌────▼────────────────────────────────────────┐
  │  ReAct Loop (max_iterations=200)            │
  │                                             │
  │  LLM thinks → calls tool → observes result │
  │  ↑_________________________________________|
  │                                             │
  │  Tools: explore_schema, describe_table,    │
  │         execute_sql, save_classification,  │
  │         save_relationships                 │
  └─────────────────────────────────────────────┘
       │
       ▼
ProgressEvent SSE stream → frontend polls
GET /api/v1/jobs/{id}/stream
```

### B. Analyst Question (Chat)

```
User types question
       │
       ▼
POST /api/v1/agent  (body: {message, job_id})
  → build_supervisor(llm, discovery_agent, analyst_agent)
  → supervisor LLM call → routes to analyst_agent
       │
       ▼
  ┌────▼────────────────────────────────────────┐
  │  Analyst ReAct Loop                        │
  │                                             │
  │  get_semantic_catalog()  ← AI Memory first │
  │  search_tables(query)    ← vector search   │
  │  describe_table(fqn)     ← raw schema      │
  │  execute_sql(sql)        ← live data       │
  │  create_chart(...)       ← optional        │
  └─────────────────────────────────────────────┘
       │
       ▼
SSE stream tokens → chat UI renders progressively
```

### C. Presentation Session

```
User opens /dashboards/{id}/present
       │
       ▼
POST /api/v1/present/{dashboard_id}/session
  → PresentationSession stored in-process dict
  → session_id returned
       │
       ▼
User clicks "Start Presentation"
  → HTMLAudioElement unlocked synchronously  ← iOS WebKit autoplay fix
       │
       ▼
POST /api/v1/present/session/{id}/ask  (body: narrate or question)
  → build_communication_agent(llm, ctx, dashboard_id)
  → agent streams answer text
  → POST /api/v1/present/tts  → OpenAI TTS → MP3 bytes
  → frontend swaps HTMLAudioElement.src → plays
```

---

## 4. Backend — FastAPI Application

### Entry Point

**`backend/src/api/main.py`** — `create_app() -> FastAPI`

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # On startup: start TTL-based session cleanup task
    cleanup_task = present_router.start_session_cleanup()
    yield
    # On shutdown: cancel cleanup, dispose SQLAlchemy engine
    cleanup_task.cancel()
    await cleanup_task  # suppress CancelledError
    await engine.dispose()
```

### Middleware

- **CORSMiddleware** — `allow_origins=settings.cors_origins`, credentials=True, all methods + headers
- **No auth middleware** — auth is per-route via FastAPI dependency injection

### Dependency Injection (`api/dependencies.py`)

```
get_current_user()
  → reads Authorization: Bearer <jwt>
  → validates with Supabase service role key
  → returns User(id=tenant_id, email=...)

get_db()
  → yields AsyncSession from session_factory

get_engine()
  → returns global QueryEngine singleton
```

### Router Registration

| Prefix | Module | Responsibility |
|--------|--------|----------------|
| `/api/v1/jobs` | `jobs.py` | Job CRUD + background discovery trigger |
| `/api/v1/jobs/{id}` | `catalog.py`, `semantic.py` | Catalog browse, semantic layer |
| `/api/v1/agent` | `agent.py` | Unified SSE agent endpoint |
| `/api/v1/charts` | `charts.py` | Chart CRUD |
| `/api/v1/dashboards` | `dashboards.py` | Dashboard CRUD + layout |
| `/api/v1/datasets` | `datasets.py` | Dataset CRUD + data fetch |
| `/api/v1/sql-lab` | `sql_lab.py` | Raw SQL execution |
| `/api/v1/present` | `present.py` | TTS + presentation sessions |
| `/api/v1/settings` | `settings.py` | LLM config, business context |
| `/api/v1/usage` | `usage.py` | Token usage stats |

### SSE Streaming Pattern

```python
# All streaming endpoints use EventSourceResponse
async def stream_tokens(request: Request, ...) -> EventSourceResponse:
    async def generator():
        async for chunk in agent.astream_events(...):
            yield {"data": chunk.text, "event": "token"}
        yield {"data": "[DONE]", "event": "done"}
    return EventSourceResponse(generator())
```

---

## 5. Agent Architecture (LangGraph)

All agents are **LangGraph ReAct graphs** — a loop of: LLM thinks → calls tool → observes result → decides next step. The loop continues until the LLM emits a final answer with no tool call.

### AgentToolsContext

**`backend/src/agents/core.py`**

Every agent receives a context object carrying all shared state and DB handles:

```python
@dataclass
class AgentToolsContext:
    job_id: str
    engine: QueryEngine           # DuckDB read-only connector
    session_factory: Callable     # async with ctx.session_factory() as s: ...
    tenant_id: str = ""           # Supabase user UUID — scopes all DB ops
    alias_map: dict[str, str] = field(default_factory=dict)  # job_id → alias

    # Runtime discovery state
    tables_discovered: list[TableMeta] = field(default_factory=list)
    tables_total: int = 0
    tables_saved: int = 0
    relationships_saved: list[Relationship] = field(default_factory=list)
    semantic_models_saved: list[SemanticModel] = field(default_factory=list)

    # Token usage tracking
    input_tokens: int = 0
    output_tokens: int = 0
```

### LLM Factory

```python
def build_llm(
    provider: str | None = None,    # "openai" | "anthropic" | "ollama" | "groq"
    api_key: str | None = None,
    model: str | None = None,
) -> Any:
```

Provider settings are loaded from the `app_settings` table (UI-configurable), falling back to `config.py` env vars. This means the LLM can be switched without redeploying.

---

### 5.1 Supervisor

**`backend/src/agents/supervisor.py`**

```python
def build_supervisor(llm: Any, discovery_agent: Any, analyst_agent: Any) -> Any:
```

**Graph:**
```
START → supervisor_node → [conditional] → discovery_agent → END
                                       → analyst_agent   → END
```

**Routing:** The supervisor calls the LLM once with `SUPERVISOR_PROMPT + user_message`. The LLM output determines which sub-agent to invoke. The decision is stored in state as `__next__`. No tools are executed at the supervisor level.

---

### 5.2 Discovery Agent

**`backend/src/agents/discovery.py`**

```python
def build_discovery_agent(llm: Any, ctx: AgentToolsContext):
```

**Graph:** `create_react_agent(llm, tools, max_iterations=200)`

**Tools (closures over `ctx`):**

| Tool | Signature | Purpose |
|------|-----------|---------|
| `explore_schema` | `(database_alias: str \| None) -> str` | List all schemas + table names |
| `describe_table` | `(table_fqn: str) -> str` | Column types, PK/FK flags |
| `execute_sql` | `(sql: str) -> str` | Sample rows for type inference |
| `save_classification` | `(table_fqn: str, model_json: str) -> str` | Persist semantic model |
| `save_relationships` | `(relationships_json: str) -> str` | Persist FK graph |

**Classification JSON schema** (`model_json` argument):
```json
{
  "database_name": "<string>",
  "schema_name": "<string>",
  "table_name": "<string>",
  "table_type": "fact | dimension | bridge | unknown",
  "description": "One sentence describing what this table stores.",
  "grain": "What one row in this table represents.",
  "entities": [
    {
      "name": "<business name>",
      "entity_type": "primary | foreign",
      "column_name": "<column>",
      "description": "<meaning>"
    }
  ],
  "dimensions": [
    {
      "name": "<business name>",
      "dim_type": "categorical | time",
      "column_name": "<column>",
      "description": "<meaning>",
      "time_granularity": "day | week | month | year | null"
    }
  ],
  "measures": [
    {
      "name": "<business name>",
      "agg": "count | sum | avg | min | max | count_distinct",
      "expr": "<column_name>",
      "description": "<meaning>"
    }
  ]
}
```

**Constraint:** The Discovery prompt instructs the agent to classify EVERY table. No table is skipped.

---

### 5.3 Analyst Agent

**`backend/src/agents/analyst.py`**

```python
def build_analyst_agent(
    llm: Any,
    ctx: AgentToolsContext,
    business_context: str | None = None,
    extra_system_prompt: str | None = None,
) -> Any:
```

**Graph:** `create_react_agent(llm, tools)`

**Tools (closures over `ctx`):**

| Tool | Signature | Purpose |
|------|-----------|---------|
| `get_semantic_catalog` | `() -> str` | Load full AI Memory (semantic models) |
| `list_databases` | `() -> str` | List attached DB aliases |
| `search_tables` | `(query: str) -> str` | Vector similarity search |
| `describe_table` | `(table_fqn: str) -> str` | Raw column schema |
| `get_relationships` | `() -> str` | FK join paths |
| `execute_sql` | `(sql: str) -> str` | Read-only live query |
| `create_chart` | `(sql, name, chart_type, x_column, y_columns, description) -> str` | Persist chart |
| `list_charts` | `() -> str` | List user's charts |
| `list_dashboards` | `() -> str` | List user's dashboards |
| `create_dashboard` | `(name, description) -> str` | Create dashboard |
| `get_dashboard_charts` | `(dashboard_id: str) -> str` | Fetch charts in dashboard |
| `add_chart_to_dashboard` | `(dashboard_id, chart_id) -> str` | Attach chart |

**System prompt injection order (highest priority first):**
1. `extra_system_prompt` (caller-provided context for the current session)
2. `business_context` (from `app_settings` table — domain knowledge)
3. `ANALYST_PROMPT` (base instructions)

**Workflow philosophy:** Semantic-first. The agent calls `get_semantic_catalog()` before writing any SQL, so it has full context about table meanings, relationships, and business terminology before touching the live database.

---

### 5.4 Communication Agent

**`backend/src/agents/communication.py`**

```python
def build_communication_agent(
    llm: Any,
    ctx: AgentToolsContext,
    dashboard_id: str,
) -> Any:
```

**Graph:** `create_react_agent(llm, tools)`

**Tools:** `get_dashboard_charts`, `get_semantic_catalog`, `list_databases`, `search_tables`, `describe_table`, `get_relationships`, `execute_sql`

**Output rules (enforced in prompt):**
- Plain English only — no markdown, no code blocks, no SQL in the response text
- Audience-friendly phrasing — explain the "so what", not the "how"
- Read-only — never attempt to modify data

**Voice pipeline:**
```
Browser (Web Speech API)
  → transcript text → POST /present/session/{id}/ask
  → Communication Agent streams answer text (SSE)
  → Frontend accumulates full text
  → POST /present/tts  {text: "..."}
  → OpenAI TTS API → MP3 bytes
  → Frontend: audioEl.src = URL.createObjectURL(blob)
  → audioEl.play()   ← safe: element was unlocked in user gesture
```

**iOS WebKit autoplay fix:** A single `HTMLAudioElement` is created on component mount and unlocked synchronously inside the "Start Presentation" `onClick` handler (before any `await`). All subsequent narration reuses this element by swapping `.src`. Creating a new `HTMLAudioElement` per narration chunk would fail — WebKit only unlocks the specific instance touched in the user gesture.

---

### 5.5 Complete Tool Reference

| Tool | Discovery | Analyst | Communication | Description |
|------|:---------:|:-------:|:-------------:|-------------|
| `explore_schema` | ✓ | — | — | List DBs, schemas, tables |
| `describe_table` | ✓ | ✓ | ✓ | Column types, PKs, FKs |
| `execute_sql` | ✓ | ✓ | ✓ | Read-only DuckDB execution |
| `save_classification` | ✓ | — | — | Persist semantic model |
| `save_relationships` | ✓ | — | — | Persist FK graph |
| `get_semantic_catalog` | — | ✓ | ✓ | Load AI Memory |
| `search_tables` | — | ✓ | ✓ | Vector similarity search |
| `get_relationships` | — | ✓ | ✓ | Retrieve FK graph |
| `list_databases` | — | ✓ | ✓ | List DB aliases |
| `get_dashboard_charts` | — | ✓ | ✓ | Charts in a dashboard |
| `create_chart` | — | ✓ | — | Save chart definition |
| `list_charts` | — | ✓ | — | User's saved charts |
| `create_dashboard` | — | ✓ | — | Create dashboard |
| `list_dashboards` | — | ✓ | — | User's dashboards |
| `add_chart_to_dashboard` | — | ✓ | — | Attach chart to dashboard |

---

## 6. Query Engine (DuckDB)

**`backend/src/query_engine/engine.py`** — `class QueryEngine`

### Purpose

A single in-memory DuckDB connection serves as the universal SQL execution layer. External source databases are **attached** to this connection in `READ_ONLY` mode. The LLM never talks to source databases directly.

### Public Interface

```python
class QueryEngine:
    def __init__(
        self,
        max_rows: int = settings.max_rows_per_query,     # default 1000
        timeout_s: int = settings.query_timeout_seconds,  # default 30
    ) -> None: ...

    def attach(self, config: SourceConfig) -> str:
        """ATTACH source in READ_ONLY mode. Returns alias string."""

    def execute(self, sql: str) -> pd.DataFrame:
        """Execute query, apply LIMIT, return DataFrame."""

    def execute_raw(self, sql: str) -> list[dict[str, Any]]:
        """Execute and return list of dicts."""

    def execute_unlimited(self, sql: str) -> list[dict[str, Any]]:
        """Execute without row cap (caller is responsible)."""

    def close(self) -> None:
        """Release DuckDB connection and thread executor."""
```

### Three-Layer Read-Only Enforcement

Every `execute()` call passes through all three layers:

```
sql string
    │
    ▼  Layer 1: sqlglot parse
    │  _guard_readonly(sql)
    │  → parse SQL tree
    │  → if root node is not SELECT → raise ReadOnlyViolationError
    │
    ▼  Layer 2: DuckDB driver
    │  ATTACH '...' AS alias (READ_ONLY)
    │  → DuckDB physically cannot write to source
    │
    ▼  Layer 3: Result control
       _apply_limit(sql) → wraps in SELECT * FROM (...) LIMIT {max_rows}
       timeout_s → thread killed after N seconds → QueryTimeoutError
```

Any single layer independently blocks destructive operations.

### Dialect Transpilation

```python
def _sanitize_sql(self, sql: str) -> str:
    # Transpile PostgreSQL syntax → DuckDB dialect
    return sqlglot.transpile(sql, read="postgres", write="duckdb")[0]
```

Examples of automatic conversions:
- `TO_CHAR(date, 'Mon YYYY')` → `strftime('%b %Y', date)`
- `::text` casts → DuckDB equivalents
- PostgreSQL-specific window functions → DuckDB variants

This catches every dialect mismatch deterministically, without prompt engineering.

### Thread Safety

DuckDB's in-process model is not safe for concurrent access. The engine wraps all queries in a single-worker `ThreadPoolExecutor`:

```python
self._executor = ThreadPoolExecutor(max_workers=1)
# All queries submitted as: loop.run_in_executor(self._executor, ...)
```

### Source Adapters

| Source | Adapter | Mechanism |
|--------|---------|-----------|
| PostgreSQL | `adapters/postgres.py` | `INSTALL postgres; LOAD postgres; ATTACH '...' (TYPE POSTGRES, READ_ONLY)` |
| MySQL | `adapters/mysql.py` | `INSTALL mysql; LOAD mysql; ATTACH '...' (TYPE MYSQL, READ_ONLY)` |
| DuckDB file | `adapters/duckdb_file.py` | `ATTACH '/path/file.duckdb' (READ_ONLY)` |
| S3 / Parquet | `adapters/s3_parquet.py` | `SET s3_* credentials; CREATE VIEW AS SELECT * FROM read_parquet('s3://...')` |

### Exception Types

```python
class ReadOnlyViolationError(Exception): ...   # non-SELECT detected
class QueryTimeoutError(Exception): ...         # query exceeded timeout_s
```

---

## 7. AI Memory (pgvector)

### Purpose

After the Discovery Agent catalogs a database, it generates **vector embeddings** for every table (using the table name, description, grain, and semantic model). These are stored in PostgreSQL via the `pgvector` extension.

When the Analyst Agent answers a question, it performs **cosine similarity search** over these embeddings to find the most relevant tables — without re-reading the source database schema.

### Embedding Generation

**`backend/src/embeddings/service.py`**

- **Model:** `text-embedding-3-small` (OpenAI, 1536-dimensional vectors)
- **Text input:** Concatenated table name + description + column names + semantic model summary
- **Triggered:** After `save_classification()` completes for each table during discovery

### Storage

```sql
-- vector_embeddings table (created in migration 0005)
CREATE TABLE vector_embeddings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    object_type VARCHAR NOT NULL,   -- 'table' | 'column'
    object_id   UUID NOT NULL,      -- FK to discovered_tables or discovered_columns
    embedding   vector(1536),       -- pgvector column
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON vector_embeddings USING ivfflat (embedding vector_cosine_ops);
```

### Search

```python
# embedding_repo.py
async def search(
    session: AsyncSession,
    tenant_id: str,
    query_embedding: list[float],
    limit: int = 10,
) -> list[VectorEmbedding]:
    # Uses pgvector <=> (cosine distance) operator
    # Filtered by tenant_id before distance computation
```

### Why This Matters

- **Zero latency schema discovery** — no live DB call needed to find relevant tables
- **Semantic matching** — "revenue" finds `order_totals`, `payment_events` even without exact name match
- **Persistent** — built once, available forever; never re-discovered
- **Isolated** — per-tenant; no cross-tenant leakage

---

## 8. Storage Layer

### SQLAlchemy Setup

**`backend/src/storage/database.py`**

```python
engine = create_async_engine(
    settings.database_url,
    pool_size=4,
    max_overflow=2,
    connect_args={"statement_cache_size": 0},  # required for Supavisor transaction mode
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

@asynccontextmanager
async def session_factory() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
```

The `statement_cache_size=0` setting is required because Supabase's Supavisor transaction pooler does not support asyncpg prepared statements.

### Repository Pattern

All data access goes through typed repository classes. Each repository:
- Accepts an `AsyncSession` (injected via `get_db()` dependency)
- Always filters by `tenant_id`
- Returns typed Pydantic models, not raw ORM objects

```
repositories/
├── charts_repo.py        # ChartRepository
├── embedding_repo.py     # EmbeddingRepository
├── job_repo.py           # JobRepository
├── profile_repo.py       # ProfileRepository
├── relationship_repo.py  # RelationshipRepository
├── schema_repo.py        # SchemaRepository (tables + columns)
├── semantic_repo.py      # SemanticRepository
├── settings_repo.py      # SettingsRepository
└── token_usage_repo.py   # TokenUsageRepository
```

### ORM Models

```
orm/
├── charts.py        # Chart, Dashboard, DashboardChart, Dataset
├── embedding.py     # VectorEmbedding
├── job.py           # Job
├── profile.py       # ColumnProfile
├── relationship.py  # Relationship
├── schema.py        # DiscoveredTable, DiscoveredColumn
├── semantic.py      # SemanticModel, Entity, Dimension, Measure
├── settings.py      # AppSettings
└── token_usage.py   # TokenUsage
```

---

## 9. Database Schema

### Migration History

| # | Migration | Purpose |
|---|-----------|---------|
| 0001 | `0001_initial_schema.py` | Core catalog: jobs, tables, columns, relationships, semantic models, entities, dimensions, measures, column_profiles |
| 0002 | `0002_app_settings.py` | `app_settings`: LLM provider config + business context |
| 0003 | `0003_job_source_config.py` | `source_config` JSONB column on jobs |
| 0004 | `0004_token_usage.py` | `token_usage`: input/output token tracking |
| 0005 | `0005_embeddings.py` | `vector_embeddings` with pgvector column |
| 0006 | `0006_charts_dashboards.py` | `charts`, `dashboards`, `datasets`, `dashboard_charts` |
| 0007 | `0007_multi_tenant.py` | `tenant_id UUID` added to all tables |

### Schema Diagram (logical)

```
jobs
 ├── discovered_tables
 │    ├── discovered_columns
 │    ├── column_profiles
 │    ├── semantic_models
 │    │    ├── entities
 │    │    ├── dimensions
 │    │    └── measures
 │    └── vector_embeddings (object_type='table')
 └── relationships (from_table_id, to_table_id)

datasets (independent, scoped by tenant_id + job_id)
 └── charts
      └── dashboard_charts ──┐
                             │
dashboards ──────────────────┘

app_settings (one row per tenant)
token_usage (many rows per tenant, one per interaction)
```

### Key Table Definitions

**`jobs`**
```
id               UUID PK
tenant_id        UUID NOT NULL
status           VARCHAR  -- pending | running | done | failed
source_type      VARCHAR  -- postgres | mysql | duckdb | s3_parquet
source_config    JSONB    -- encrypted connection params
tables_total     INT
tables_processed INT
error_message    TEXT
created_at       TIMESTAMPTZ
updated_at       TIMESTAMPTZ
```

**`discovered_tables`**
```
id             UUID PK
tenant_id      UUID NOT NULL
job_id         UUID FK → jobs.id
database_name  VARCHAR
schema_name    VARCHAR
table_name     VARCHAR
row_count      BIGINT
description    TEXT
```

**`discovered_columns`**
```
id             UUID PK
table_id       UUID FK → discovered_tables.id
column_name    VARCHAR
column_type    VARCHAR
nullable       BOOL
is_primary_key BOOL
is_foreign_key BOOL
ordinal        INT
```

**`semantic_models`**
```
id          UUID PK
tenant_id   UUID NOT NULL
table_id    UUID FK → discovered_tables.id
table_type  VARCHAR  -- fact | dimension | bridge | unknown
description TEXT
grain       TEXT     -- "what one row represents"
```

**`entities` / `dimensions` / `measures`**
```
id               UUID PK
semantic_model_id UUID FK → semantic_models.id

-- entities
name         VARCHAR
entity_type  VARCHAR  -- primary | foreign
column_name  VARCHAR
description  TEXT

-- dimensions
name              VARCHAR
dim_type          VARCHAR  -- categorical | time
column_name       VARCHAR
description       TEXT
time_granularity  VARCHAR  -- day | week | month | year | null

-- measures
name        VARCHAR
agg         VARCHAR  -- count | sum | avg | min | max | count_distinct
expr        TEXT     -- column name or expression
description TEXT
```

**`relationships`**
```
id            UUID PK
tenant_id     UUID NOT NULL
job_id        UUID FK → jobs.id
from_table_id UUID FK → discovered_tables.id
to_table_id   UUID FK → discovered_tables.id
from_column   VARCHAR
to_column     VARCHAR
confidence    FLOAT   -- 0.0 to 1.0
source        VARCHAR -- detected | inferred
```

**`app_settings`**
```
id               UUID PK
tenant_id        UUID NOT NULL UNIQUE
active_provider  VARCHAR   -- openai | anthropic | ollama | groq
providers        JSONB     -- {openai: {api_key, model}, anthropic: {api_key, model}, ...}
business_context TEXT
```

**`vector_embeddings`**
```
id          UUID PK
tenant_id   UUID NOT NULL
object_type VARCHAR  -- table | column
object_id   UUID
embedding   vector(1536)   -- pgvector
created_at  TIMESTAMPTZ
```

**`charts`**
```
id          UUID PK
tenant_id   UUID NOT NULL
dataset_id  UUID FK → datasets.id
title       VARCHAR
chart_type  VARCHAR   -- bar | line | pie | scatter | ...
definition  JSONB     -- ECharts/Recharts config
created_at  TIMESTAMPTZ
```

**`dashboards`**
```
id         UUID PK
tenant_id  UUID NOT NULL
title      VARCHAR
layout     JSONB     -- React Grid Layout positions [{i, x, y, w, h}]
created_at TIMESTAMPTZ
```

**`token_usage`**
```
id               UUID PK
tenant_id        UUID NOT NULL
interaction_type VARCHAR   -- discovery | analyst | communication
input_tokens     BIGINT
output_tokens    BIGINT
created_at       TIMESTAMPTZ
```

---

## 10. Frontend Architecture

### Tech Stack

| Concern | Library | Version |
|---------|---------|---------|
| Framework | Next.js (App Router) | 16.1.7 |
| UI runtime | React | 19.2.3 |
| Styling | Tailwind CSS | 4 |
| Components | shadcn/ui | custom |
| Charts | ECharts + Recharts | — |
| Relationship graph | React Flow | — |
| Dashboard layout | React Grid Layout | — |
| Data fetching | TanStack Query | — |
| State | Zustand | — |
| Auth | @supabase/ssr | — |
| Animations | Framer Motion | — |
| Fonts | Geist Sans/Mono + Syne | — |

### App Routes

```
/                                   Public landing page (no auth required)
/auth/login                         Login form
/auth/signup                        Signup form
/auth/callback                      Supabase OAuth callback handler
/overview                           App dashboard (protected)
/databases                          Connection management (protected)
/jobs/new                           Create discovery job
/jobs/[id]                          Job detail + live progress (SSE)
/jobs/[id]/catalog                  Discovered tables browser
/jobs/[id]/profiles                 Column profiling stats
/jobs/[id]/relationships            FK graph (React Flow)
/jobs/[id]/semantic                 Semantic layer editor
/chat                               AI Assistant (streams Analyst agent)
/sql-lab                            Raw SQL editor
/charts                             Charts gallery
/charts/new                         Chart builder
/charts/[id]                        Chart detail
/dashboards                         Dashboards gallery
/dashboards/[id]                    Dashboard drag-and-drop builder
/dashboards/[id]/present            Presentation mode + TTS
/settings                           LLM config, business context, token usage
```

### Auth Flow (proxy.ts)

**`frontend/src/proxy.ts`** — Next.js 16 equivalent of `middleware.ts` (exported as `proxy` function)

```
Incoming request
       │
       ▼
proxy(request)
  ├── pathname === "/"
  │     ├── authenticated? → redirect /overview
  │     └── not authenticated? → serve landing page
  ├── pathname starts with "/auth"
  │     └── always serve (login/signup forms)
  └── all other paths
        ├── no Supabase session? → redirect /auth/login?next=<path>
        └── has session? → serve page
```

After successful login:
```
LoginForm reads ?next=... query param
→ router.push(next || "/overview")
```

### Component Architecture

```
src/components/
├── layout/
│   ├── app-shell.tsx       # Client component using usePathname()
│   │                       # Renders <Sidebar> only for non-auth, non-landing routes
│   └── sidebar.tsx         # Nav links, theme toggle, sign-out
│                           # Dashboard link → /overview
├── ui/                     # shadcn/ui: Button, Input, Dialog, Sheet, Table, ...
├── chat/
│   ├── MessageList         # Renders streamed agent messages
│   ├── MessageInput        # Submit + stop controls
│   └── ChartEmbed          # Inline chart rendering inside chat bubbles
├── charts/
│   ├── ChartEditor         # Form: type, SQL, axis config
│   └── ChartRenderer       # ECharts or Recharts based on chart_type
├── dashboards/
│   ├── DashboardGrid       # React Grid Layout wrapper
│   └── ChartTile           # Individual chart in dashboard
├── catalog/
│   ├── TableBrowser        # Paginated table list with semantic badges
│   └── ColumnList          # Column type + PK/FK + profile inline
├── relationships/
│   └── RelationshipGraph   # React Flow graph: tables as nodes, FKs as edges
├── profiles/
│   └── ProfileTable        # Min/max/nulls/distinct per column
├── semantic/
│   └── SemanticEditor      # Edit dimensions, measures inline
├── jobs/
│   ├── JobStatus           # Badge: pending | running | done | failed
│   ├── ProgressBar         # tables_processed / tables_total
│   └── LogStream           # SSE consumer for /jobs/{id}/stream
├── settings/
│   ├── LLMProviderPanel    # Provider selector + key input + test button
│   └── TokenUsage          # Input/output token breakdown chart
└── presentation/
    ├── PresentationController  # Slide navigator, start/stop
    ├── NarrationPlayer         # HTMLAudioElement wrapper, iOS fix
    └── QAInput                 # Mic → Web Speech API → POST /ask
```

### Data Fetching Pattern

All server state managed via **TanStack Query**:

```typescript
// Example: fetch charts
const { data: charts, isLoading } = useQuery({
  queryKey: ["charts"],
  queryFn: () => api.charts.list(),
  staleTime: 10_000,
  retry: 1,
})

// Example: stream agent response
const mutation = useMutation({
  mutationFn: async (message: string) => {
    const source = new EventSource(`/api/v1/agent?...`)
    source.onmessage = (e) => setTokens(t => t + e.data)
  }
})
```

---

## 11. Authentication & Multi-Tenancy

### Auth Provider: Supabase

- **Frontend auth:** `@supabase/ssr` client with cookie-based session management
- **Backend auth:** JWT validated via Supabase service role key on every request
- **User identity:** `user.id` (UUID) is the `tenant_id` used throughout

### JWT Flow

```
User logs in → Supabase issues JWT
  → stored in HTTP-only cookie (SSR) or localStorage
  → every API request includes: Authorization: Bearer <jwt>
  → backend: supabase.auth.get_user(jwt) → User(id=tenant_id)
  → tenant_id injected into get_current_user() dependency
  → all repository calls receive tenant_id
```

### Multi-Tenancy Implementation

Every ORM table has a `tenant_id UUID NOT NULL` column (added in migration 0007). Every repository method applies a `WHERE tenant_id = :tenant_id` filter. This is enforced at the data layer, not the API layer — even if a bug skips the auth check, a query without the correct `tenant_id` returns zero rows.

**No row-level security is used.** The PostgreSQL user has full table access; isolation is enforced by application-level `tenant_id` filtering.

---

## 12. Environment Variables

### Backend (`backend/.env`)

```bash
# ── Required ──────────────────────────────────────────────────────────────────

# Supavisor transaction pooler URL (IPv4-compatible, port 6543)
DATABASE_URL=postgresql+asyncpg://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres

# Direct URL for Alembic migrations (optional — use if pooler blocks DDL)
ALEMBIC_DATABASE_URL=

SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=

# JSON array of allowed origins
CORS_ORIGINS=["https://knoda.itsamoghgr.com","http://localhost:3000"]

# ── Optional (have defaults) ───────────────────────────────────────────────────

LLM_PROVIDER=openai                    # openai | anthropic | ollama | groq
LLM_MODEL=gpt-4o
LLM_API_KEY=                           # Overridable via UI Settings

MAX_ROWS_PER_QUERY=1000                # Row cap per SQL execution
QUERY_TIMEOUT_SECONDS=30               # Query kill timeout
MAX_SAMPLE_ROWS=10                     # Rows sampled per table during discovery
MAX_CONCURRENT_TABLE_TASKS=10          # Parallel table classification tasks

API_HOST=0.0.0.0
API_PORT=8000
```

### Frontend (`frontend/.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=https://api.knoda.itsamoghgr.com   # backend base URL
```

---

## 13. Deployment

### Production Stack

```
User browser
    │  HTTPS
    ▼
Vercel (frontend)
    │  Next.js 16 — SSR + static + API routes
    │  NEXT_PUBLIC_API_URL → DigitalOcean
    │
    ▼
DigitalOcean App Platform (backend)
    │  1 uvicorn worker — FastAPI
    │  Docker container: Dockerfile.backend
    │  Health: GET /api/v1/health (30s interval)
    │
    ▼
Supabase
    ├── PostgreSQL 16 + pgvector
    ├── Supavisor transaction pooler (port 6543, IPv4)
    └── Auth service (JWT issuance + verification)
```

### DigitalOcean App Spec (`.do/app.yaml`)

```yaml
name: knoda-backend
region: nyc
services:
  - name: api
    github:
      repo: itsamoghgr/db-discovery-agent
      branch: main
      deploy_on_push: true
    dockerfile_path: docker/Dockerfile.backend
    http_port: 8000
    instance_size_slug: apps-s-1vcpu-2gb
    run_command: uvicorn api.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1
    health_check:
      http_path: /api/v1/health
      period_seconds: 30
```

### Why 1 Worker

Presentation sessions (`POST /present/{id}/session`) are stored as a Python dict in-process. If multiple uvicorn workers run, a request creating a session on worker A and a request using that session could land on worker B (session not found → 404). Solution: pin to 1 worker. Future path: move session state to Redis.

### Supabase Connection Notes

DigitalOcean App Platform routes traffic over **IPv4 only**. Supabase's direct PostgreSQL connection is **IPv6 only**. Resolution:

1. Use **Supavisor transaction pooler** (`host:6543`) — routes over IPv4
2. Set `statement_cache_size=0` in SQLAlchemy `connect_args` — transaction pooler mode doesn't support asyncpg prepared statements
3. Apply the same fix to Alembic's engine in `alembic/env.py`

### Local Development

```bash
# Option A: Docker Compose (PostgreSQL + backend together)
cd docker
docker-compose up

# Option B: Manual
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn api.main:create_app --factory --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev   # http://localhost:3000
```

### CI/CD

**`.github/workflows/ci.yml`** — runs on every push and PR to `main`:

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uv run ruff check src/
      - uv run ruff format --check src/
```

Vercel and DigitalOcean deploy automatically on push to `main`.

---

## 14. Data Flow Diagrams

### Discovery: Schema → AI Memory

```
Source DB (Postgres/MySQL/DuckDB/S3)
        │
        │  ATTACH READ_ONLY
        ▼
   DuckDB (in-memory)
        │
        │  explore_schema() → table names
        │  describe_table() → columns + types
        │  execute_sql()    → sample rows (optional)
        ▼
   Discovery Agent (LangGraph ReAct)
        │
        │  LLM classifies: table_type, grain, dimensions, measures
        ▼
   save_classification()
        │
        │  INSERT INTO semantic_models, entities, dimensions, measures
        ▼
   PostgreSQL (Supabase)
        │
        │  Embedding service
        │  OpenAI text-embedding-3-small(table_text)
        ▼
   vector_embeddings table (pgvector)
        │
        ▼
   AI Memory — ready for Analyst queries
```

### Analyst: Question → Answer → Chart

```
User question: "What was ARR by region last quarter?"
        │
        ▼
POST /api/v1/agent
        │
        ▼
Supervisor (1 LLM call) → routes to Analyst
        │
        ▼
Analyst ReAct Loop
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  1. get_semantic_catalog()                          │
  │     → load all semantic models from PostgreSQL      │
  │                                                     │
  │  2. search_tables("ARR region quarter")             │
  │     → cosine similarity search in pgvector          │
  │     → returns top-N relevant table names            │
  │                                                     │
  │  3. describe_table("public.orders")                 │
  │     → raw column list from DuckDB                   │
  │                                                     │
  │  4. execute_sql("SELECT region, SUM(arr)...")       │
  │     → DuckDB executes against attached source DB    │
  │     → returns DataFrame → JSON rows                 │
  │                                                     │
  │  5. create_chart(sql, "ARR by Region", "bar", ...)  │
  │     → INSERT INTO charts                            │
  │     → chart_id returned                             │
  │                                                     │
  └─────────────────────────────────────────────────────┘
        │
        ▼
SSE stream → frontend renders chart inline in chat
```

---

## 15. Key Design Decisions

### 1. DuckDB as Universal Query Layer

All source databases attach to a single in-memory DuckDB connection. This gives one consistent SQL interface across Postgres, MySQL, DuckDB files, and S3/Parquet. The LLM writes one dialect; the engine handles the rest.

**Trade-off:** DuckDB is in-process and single-connection — not suitable for high-concurrency workloads. Acceptable at current scale; future path is a connection pool per tenant.

### 2. Three-Layer Read-Only Enforcement

Data safety is enforced at three independent levels: DuckDB `READ_ONLY` attach, sqlglot parse rejection, and result caps. Three layers because any single layer can theoretically be bypassed (driver bug, parser edge case) — defense in depth.

### 3. sqlglot Dialect Transpilation Over Prompt Engineering

Prompting the LLM "use DuckDB SQL" is unreliable — the LLM's training data is overwhelmingly PostgreSQL. `sqlglot.transpile(read="postgres", write="duckdb")` catches mismatches deterministically. Used in combination with the LLM prompt for belt-and-suspenders correctness.

### 4. Semantic-First Query Planning

The Analyst Agent always calls `get_semantic_catalog()` before writing SQL. This gives the LLM full context (table meanings, business terminology, grain, measures) before it tries to construct a query — dramatically reducing hallucinated column names and wrong table joins.

### 5. Persistent AI Memory (pgvector)

Discovery runs once. The resulting semantic models and embeddings persist in PostgreSQL. Every subsequent Analyst query starts with full schema context and semantic search. This is the core moat — the system gets smarter with each query without re-running discovery.

### 6. Repository Pattern for Tenant Isolation

All DB access flows through typed repository classes that always filter by `tenant_id`. Isolation is enforced at the data layer, not the API layer. A route bug cannot accidentally expose another tenant's data.

### 7. SSE Over WebSockets

Agent output and discovery progress stream via Server-Sent Events. SSE is simpler to deploy (no sticky sessions, works through HTTP/1.1), has native browser support, and is uni-directional (server → client) which is all that's needed. The one limitation — client cannot push mid-stream — is handled by separate REST calls.

### 8. LangGraph ReAct Over Sequential Chains

Discovery requires exploring an unknown number of tables; analysis requires iterating on SQL until correct. Sequential chains with fixed steps can't handle this. ReAct graphs loop until the agent decides it's done — essential for open-ended tasks.

### 9. LLM Provider Abstraction

`build_llm()` returns a LangChain-compatible chat model regardless of provider. The active provider and credentials are stored in `app_settings` (PostgreSQL), switchable via UI with no redeploy. Supported: OpenAI, Anthropic, Groq, Ollama (local).

### 10. Single Uvicorn Worker

Presentation sessions live in-process. Multiple workers would break session routing. This is an explicit, documented constraint — not an oversight. The path to multi-worker is Redis-backed session storage.

---

## 16. Known Constraints & Future Work

### Current Constraints

| Constraint | Root Cause | Future Path |
|------------|------------|-------------|
| Single uvicorn worker | In-memory presentation sessions | Move sessions to Redis |
| DuckDB single-connection | In-process DuckDB architecture | Per-tenant connection pool |
| No row-level security | Application-level tenant filtering | Add Postgres RLS for defense in depth |
| Discovery is blocking per table | asyncio.gather with semaphore | Already has `MAX_CONCURRENT_TABLE_TASKS` |
| LLM API keys stored in DB | Convenience for multi-tenant UI config | Encrypt `providers` JSONB column at rest |

### Planned Features

- **Calendar integration** — agent auto-joins scheduled meetings
- **Proactive anomaly detection** — background monitoring, surface unusual patterns
- **Scheduled reports** — PDF/email reports on a cron schedule
- **Slack / Teams integration** — query data directly in team tools
- **Multi-database reasoning** — correlate signals across all connected sources
- **Natural language → dbt** — write and document data models from plain English
- **Collaborative dashboards** — shared workspaces with comments and version history
