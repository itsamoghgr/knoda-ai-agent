# Knoda.ai — Agent Architecture v1

> **Last updated:** 2026-03-26  
> **Stack:** Python 3.12 · FastAPI · LangGraph · DuckDB · PostgreSQL · Redis · Next.js 15

---

## 1. System Overview

Knoda.ai is an **LLM-powered database intelligence platform**. Users connect their databases (Postgres, MySQL, DuckDB, S3/Parquet), run an automated discovery job, and then chat with an AI analyst that can answer data questions, write SQL, and create charts and dashboards — all without writing a single query themselves.

The backend is built around three specialized **LangGraph ReAct agents** coordinated by a **supervisor router**. Each agent operates the same Think → Tool Call → Observe loop but has a distinct role, tool set, and system prompt.

```
User / Frontend (Next.js)
        │  REST  /  SSE stream
        ▼
  FastAPI  (uvicorn)
        │
        ├── /api/v1/jobs/*       ← trigger discovery
        ├── /api/v1/agent/*      ← chat with analyst
        ├── /api/v1/present/*    ← live presentation mode
        ├── /api/v1/charts/*     ├── /api/v1/dashboards/*  (CRUD)
        └── /api/v1/sql-lab/*    ← raw SQL playground
              │
              ▼
      ┌───────────────────────────────────┐
      │         LangGraph Supervisor       │
      │   (routes to the right sub-agent) │
      └────────┬──────────────┬───────────┘
               │              │
       ┌───────▼────┐  ┌──────▼────────────────────┐
       │  Discovery  │  │  Analyst / Communication   │
       │   Agent    │  │        Agents              │
       └───────┬────┘  └──────┬────────────────────┘
               │              │
               ▼              ▼
         AgentToolsContext (shared)
               │
     ┌─────────┴──────────┐
     ▼                    ▼
 QueryEngine          Storage layer
 (DuckDB in-memory)   (PostgreSQL + Redis)
```

---

## 2. Agent Infrastructure

### 2.1 `AgentToolsContext` — Shared State Carrier

Defined in `agents/core.py`. Every agent receives one instance per request. It carries:

| Field | Purpose |
|---|---|
| `job_id` | Scopes all catalog reads/writes to a discovery job |
| `engine` | `QueryEngine` instance with the user's databases attached |
| `session_factory` | Async SQLAlchemy session factory for PostgreSQL |
| `tenant_id` | User UUID — all SQL queries are scoped to the tenant |
| `alias_map` | Maps `job_id → alias` (e.g. `src0`) for DuckDB qualified names |
| `tables_discovered` | Live list of `TableMeta` objects explored so far |
| `tables_saved` / `tables_total` | Discovery progress counters |
| `input_tokens` / `output_tokens` | Accumulated LLM token usage |

The context is constructed per-request in the API layer and injected into each sub-agent via closure — tools capture `ctx` at the point they are registered.

### 2.2 LLM Factory — `build_llm()`

Single source of truth in `agents/core.py`. Supports four providers switchable at runtime (env or per-tenant settings):

| Provider | Model default | Notes |
|---|---|---|
| `openai` (default) | `gpt-4o` | streams usage stats |
| `anthropic` | configurable | `max_tokens=8096` |
| `groq` | configurable | `temperature=0` |
| `ollama` | configurable | local inference |

Provider and API key are read first from per-tenant `AppSettings` (stored in PostgreSQL), falling back to `.env`.

---

## 3. The Supervisor

**File:** `agents/supervisor.py`  
**Framework:** LangGraph `StateGraph`

The supervisor is a single LLM call that reads the user's message and outputs the name of the agent to route to. It does **not** run a tool loop — pure routing only.

```
User message
     │
     ▼
supervisor_node  ──LLM──►  "discovery_agent" | "analyst_agent"
     │
     ▼ (conditional edge)
  chosen agent's ReAct loop
     │
     ▼
    END
```

**Routing heuristic** (from the supervisor prompt):
- `"discover"`, `"catalog"`, `"analyze schema"`, `"run discovery"` → **discovery_agent**
- `"show me"`, `"how many"`, `"top"`, `"revenue"`, `"query"` → **analyst_agent**
- Default fallback: **analyst_agent**

The routing decision is stored in `state["__next__"]` and consumed by a conditional edge.

---

## 4. Discovery Agent

**File:** `agents/discovery.py`  
**Framework:** LangGraph `create_react_agent` (ReAct loop, max 200 iterations)  
**Purpose:** Exhaustively catalog every table in the connected database into the semantic store.

### Tool set (5 tools)

| Tool | What it does |
|---|---|
| `explore_schema` | Lists all schemas + tables with column counts and row estimates; populates `ctx.tables_discovered` |
| `describe_table(fqn)` | Returns full column schema (names, types, PKs, FKs, nullability) for `alias.schema.table` |
| `execute_sql(sql)` | Read-only SELECT; used **only** when data evidence is needed to resolve ambiguity |
| `save_classification(fqn, json)` | Persists a `SemanticModel` to PostgreSQL; triggers embedding generation in a background best-effort step |
| `save_relationships(json)` | Saves all FK + inferred relationships in a single batch call after all tables are classified |

### Discovery Workflow

```
1. explore_schema()          → get full table inventory
2. for each table:
   a. describe_table(fqn)    → get columns
   b. execute_sql() (if needed) → sample data to resolve ambiguity
   c. save_classification()  → persist SemanticModel + embedding
3. save_relationships()      → batch-save all FK / inferred links
```

### Classification Schema

Each table is classified as one of: **fact**, **dimension**, **bridge**, or **unknown**.

For every table the agent produces a `SemanticModel` containing:
- `table_type`, `description`, `grain`
- `entities` — primary/foreign keys
- `dimensions` — categorical or time columns
- `measures` — numeric metrics with aggregation type (sum, count, avg, min, max, count_distinct)

### Side-effect: Embeddings

`save_classification` (in `core.py`) immediately calls `EmbeddingService` (text-embedding-3-small by default) to embed a rich text representation of the model and stores the vector in the `embeddings` table. This powers semantic search in the Analyst agent.

---

## 5. Analyst Agent

**File:** `agents/analyst.py`  
**Framework:** LangGraph `create_react_agent` (unbounded iterations)  
**Purpose:** Answer data questions, write SQL, and create charts/dashboards.

### Tool set (12 tools)

#### Schema & Catalog tools
| Tool | What it does |
|---|---|
| `get_semantic_catalog()` | Loads the **full** pre-built catalog from PostgreSQL — all tables, types, grain, keys, dimensions, measures, relationships. **Always called first.** |
| `list_databases()` | Lists attached DuckDB aliases (e.g. `src0`) for SQL qualification |
| `search_tables(query)` | Semantically searches the catalog: tries vector similarity (embeddings) first, falls back to keyword scoring |
| `describe_table(fqn)` | Raw column schema — used only when writing SQL that touches that table |
| `get_relationships()` | Explicit join paths as `alias.schema.table.col → alias.schema.table.col` |

#### Data tools
| Tool | What it does |
|---|---|
| `execute_sql(sql)` | Read-only SELECT against DuckDB; returns up to 100 rows as JSON |

#### Chart & Dashboard tools
| Tool | What it does |
|---|---|
| `create_chart(sql, name, type, x_col, y_cols)` | Creates a `Dataset` + `Chart` in PostgreSQL, then immediately writes a Redis snapshot of the query results |
| `list_charts()` | Lists all saved charts for the tenant |
| `list_dashboards()` | Lists all saved dashboards |
| `create_dashboard(name, description)` | Creates an empty dashboard |
| `get_dashboard_charts(dashboard_id)` | Lists charts currently on a dashboard |
| `add_chart_to_dashboard(dashboard_id, chart_id)` | Places a chart on a dashboard with smart grid auto-packing (mirrors the frontend's 12-column layout) |

### Analyst Workflow (semantic-first)

```
Schema / structure question:
  1. get_semantic_catalog()   → answer from catalog, no SQL
  2. get_relationships()      → if join paths needed

Data / analytical question:
  1. get_semantic_catalog()   → understand what's available
  2. search_tables(topic)     → narrow to relevant tables
  3. describe_table(fqn)      → get exact column names
  4. execute_sql(sql)         → run query, present as markdown table

Chart / dashboard request:
  1. get_semantic_catalog()
  2. execute_sql(sql)         → verify query works
  3. create_chart(...)        → persist chart + Redis snapshot
  4. list_dashboards() / create_dashboard()
  5. add_chart_to_dashboard()
```

---

## 6. Communication Agent (Presentation Mode)

**File:** `agents/communication.py`  
**Framework:** LangGraph `create_react_agent`  
**Purpose:** Live AI presenter for business meetings — narrates a dashboard, answers audience questions with live data.

### Tool set (7 tools — read-only, no chart/dashboard creation)

`get_dashboard_charts`, `get_semantic_catalog`, `list_databases`, `search_tables`, `describe_table`, `get_relationships`, `execute_sql`

### Key behaviors
- **No markdown** — plain spoken English only (designed for text-to-speech)
- **No pre-injected context** — discovers dashboard content autonomously via `get_dashboard_charts()` on every session start
- **Session memory** — prior conversation messages are passed in as LangGraph history on each turn
- **Dashboard-scoped** — built with a specific `dashboard_id` injected into the system prompt; never creates new artifacts

### Session lifecycle (managed by `present.py` router)
- Session created on `POST /api/v1/present/sessions`
- Each turn streamed via SSE on `POST /api/v1/present/sessions/{id}/message`
- Background cleanup task evicts sessions idle for 30+ minutes (Redis-backed)

---

## 7. Query Engine

**File:** `query_engine/engine.py`  
**Core:** DuckDB in-memory connection, single-worker `ThreadPoolExecutor`

### Source support

| Type | Connector | ATTACH mode |
|---|---|---|
| PostgreSQL | `postgres` adapter | `ATTACH 'postgres://...' AS srcN (READ_ONLY)` |
| MySQL | `mysql` adapter | DuckDB mysql extension |
| DuckDB file | `duckdb_file` adapter | `ATTACH 'path/to/file.duckdb' AS srcN (READ_ONLY)` |
| S3 / Parquet | `s3_parquet` adapter | `read_parquet('s3://...')` |

### 3-layer read-only enforcement

1. **ATTACH READ_ONLY** — DuckDB driver rejects any write at the connection level
2. **sqlglot parse guard** — every SQL string is parsed before execution; non-SELECT raises `ReadOnlyViolationError`
3. **Row cap + timeout** — results wrapped in `LIMIT {max_rows}` subquery; queries killed after `timeout_s` seconds

### SQL sanitization pipeline

```
Raw LLM SQL
    │
    ▼
_sanitize_sql()
    ├── Take first statement only (handles multi-statement LLM output)
    ├── Strip trailing semicolons
    └── Transpile: postgres dialect → duckdb dialect (via sqlglot)
         (handles TO_CHAR → strftime, EXTRACT variants, etc.)
    │
    ▼
_guard_readonly()   ← Reject non-SELECT
    │
    ▼
_apply_limit()      ← Inject LIMIT if missing
    │
    ▼
DuckDB execute
```

### Parallel query execution (`run_queries_parallel`)

Used by the dashboard refresh endpoint to refresh all charts simultaneously:
- Groups queries by source connection identity (host + port + db)
- One `QueryEngine` + one SSL handshake per unique source
- Queries for the same source run serially inside that connection
- Queries for different sources run in parallel threads (up to 6 workers)

---

## 8. Storage Layer

### PostgreSQL (operational store)

Managed via SQLAlchemy async + Alembic migrations.

**Key ORM tables:**

| Table | Purpose |
|---|---|
| `jobs` | Discovery job records — status, progress, connection config |
| `semantic_models` | One row per cataloged table; stores type, description, grain |
| `entities` | PK/FK columns per semantic model |
| `dimensions` | Categorical/time columns per semantic model |
| `measures` | Numeric metrics per semantic model |
| `relationships` | FK + inferred table links with confidence scores |
| `embeddings` | Vector embeddings (1536-dim) for semantic table search |
| `datasets` | Named SQL queries owned by a chart |
| `charts` | Chart type + config (x/y columns, legend, stack, etc.) |
| `dashboards` / `dashboard_charts` | Dashboard + grid position of each chart |
| `app_settings` | Per-tenant LLM provider, API key, and embedding config |
| `token_usage` | Per-job input/output token counts |

**Auth:** Supabase — backend verifies JWTs via `supabase.auth.get_user()` using the service role key. All queries are scoped by `tenant_id`.

### Redis (cache + session store)

Two uses:

1. **Chart snapshot cache** (`storage/snapshot_cache.py`)  
   Key: `snapshot:{chart_id}` → JSON `{columns, rows, cached_at, error}`  
   Written immediately after `create_chart()` and on dashboard refresh.  
   Read by the dashboard UI on load — eliminates a live DuckDB round-trip per chart.

2. **Presentation session store** (`api/routers/present.py`)  
   Key: `present_session:{session_id}` → LangGraph message history + `engine` object  
   TTL: 30-minute idle timeout enforced by background cleanup task.

### Embeddings service (`embeddings/service.py`)

Wraps the OpenAI embeddings API (`text-embedding-3-small`, 1536 dimensions).  
Called in two places:
- `save_classification` — embeds the newly cataloged table's rich text representation
- `search_tables` — embeds the analyst's search query, then vector-searches `embeddings` table

Falls back to keyword scoring if no embedding API key is configured.

---

## 9. API Layer

**File:** `api/main.py` — FastAPI app factory

All routes under `/api/v1/`:

| Router | Prefix | Purpose |
|---|---|---|
| `jobs` | `/jobs` | CRUD for discovery jobs; SSE stream for live job progress |
| `agent` | `/agent` | Chat with the Analyst agent; SSE streaming responses |
| `present` | `/present` | Presentation session lifecycle + SSE streaming |
| `catalog` | `/catalog` | Read-only access to the semantic catalog |
| `semantic` | `/semantic` | Semantic model CRUD |
| `datasets` | `/datasets` | Dataset (SQL query) CRUD + execution |
| `charts` | `/charts` | Chart CRUD + snapshot retrieval |
| `dashboards` | `/dashboards` | Dashboard CRUD + layout persistence + refresh |
| `sql_lab` | `/sql-lab` | Raw SQL execution (uses `execute_unlimited`) |
| `settings` | `/settings` | Per-tenant LLM + embedding settings |
| `usage` | `/usage` | Token usage statistics |

### Streaming pattern (SSE)

Both `/agent/stream` and `/present/sessions/{id}/message` stream LangGraph events via Server-Sent Events:

```
client                    FastAPI                   LangGraph
  │── POST /agent/stream ──►│                          │
  │                          │── astream_events() ────►│
  │◄── data: {"type":"token"…│◄── yield token ─────────│
  │◄── data: {"type":"token"…│◄── yield token ─────────│
  │◄── data: [DONE]          │◄── stream end ───────────│
```

Event types: `token` (streaming text chunk), `tool_use`, `tool_result`, `done`, `error`.

---

## 10. Data Flow — End to End

### A. Discovery Job

```
User clicks "Run Discovery"
    │
    ▼
POST /api/v1/jobs/{id}/run
    │
    ├── QueryEngine.attach(source_config)  ← DuckDB ATTACH READ_ONLY
    ├── build_llm()                        ← LangChain chat model
    ├── AgentToolsContext(...)             ← shared state
    ├── build_discovery_agent(llm, ctx)    ← LangGraph ReAct agent (5 tools)
    │
    └── agent.astream({"messages": [...]})
          │  [Think → explore_schema → Think → describe_table loop]
          │
          ├── save_classification()  → PostgreSQL SemanticModel
          │                          → Redis? No (discovery doesn't snapshot)
          │                          → Embedding API → embeddings table
          │
          └── save_relationships()  → PostgreSQL RelationshipORM

Live progress streamed via SSE to the frontend job page.
```

### B. Analyst Chat

```
User sends message in AI Assistant
    │
    ▼
POST /api/v1/agent/stream
    │
    ├── Load job context (QueryEngine + alias_map)
    ├── build_llm()
    ├── AgentToolsContext(...)
    ├── build_analyst_agent(llm, ctx)
    │
    └── agent.astream_events({"messages": [user_message]})
          │
          ├── get_semantic_catalog()  → SELECT FROM PostgreSQL semantic_models
          ├── search_tables()         → vector search embeddings OR keyword
          ├── execute_sql()           → DuckDB → rows as JSON
          ├── create_chart()          → INSERT chart + dataset to PostgreSQL
          │                              execute SQL → write to Redis snapshot
          └── add_chart_to_dashboard() → INSERT dashboard_charts

Streamed tokens → frontend chat bubble.
```

### C. Dashboard Load

```
User opens a dashboard
    │
    ▼
GET /api/v1/dashboards/{id}           ← chart list from PostgreSQL
GET /api/v1/charts/{id}/snapshot      ← per-chart: Redis cache hit (fast)
                                          OR re-execute SQL via DuckDB (miss)
```

---

## 11. Key Design Decisions

| Decision | Rationale |
|---|---|
| **DuckDB as query engine** | Single in-memory connection federates Postgres, MySQL, DuckDB files, and S3/Parquet without a separate ETL layer |
| **Single-worker executor** | All DuckDB calls run in the same OS thread — eliminates the need for locks given DuckDB's non-concurrent write model |
| **sqlglot transpilation** | LLMs write Postgres-flavored SQL; sqlglot converts it to DuckDB dialect transparently |
| **Semantic-first analyst** | The pre-built catalog eliminates expensive live schema introspection on every question; `execute_sql` is only called for actual data |
| **Redis snapshot cache** | Dashboard cold-load time goes from O(charts × DuckDB connect latency) to near-zero; snapshots are pre-warmed at chart creation time |
| **Embedding fallback** | Vector search degrades gracefully to keyword scoring when no OpenAI key is configured |
| **Supervisor as thin router** | A single non-streaming LLM call (no tool loop) keeps routing latency under 300ms; complexity lives in the sub-agents |
| **Communication agent isolation** | Presentation mode uses a read-only subset of tools and plain-text responses — safe for TTS and never mutates the catalog |
| **Parallel dashboard refresh** | `run_queries_parallel` groups queries by source to reuse SSL connections; one handshake per source regardless of chart count |

---

## 12. File Map

```
backend/src/
├── agents/
│   ├── core.py          # AgentToolsContext + all 14 shared tool implementations
│   ├── discovery.py     # Discovery ReAct agent (5 tools, max 200 iterations)
│   ├── analyst.py       # Analyst ReAct agent (12 tools, semantic-first prompt)
│   ├── communication.py # Communication/presenter ReAct agent (7 tools, read-only)
│   ├── supervisor.py    # LangGraph StateGraph supervisor router
│   ├── state.py         # AgentState Pydantic model (discovery pipeline)
│   └── agent.py         # Re-export shim for build_llm
│
├── query_engine/
│   ├── engine.py        # QueryEngine (DuckDB), run_queries_parallel
│   └── adapters/        # postgres, mysql, duckdb_file, s3_parquet attach helpers
│
├── api/
│   ├── main.py          # FastAPI app factory + lifespan (Redis + DB cleanup)
│   ├── dependencies.py  # Supabase JWT auth, session factory DI
│   └── routers/
│       ├── jobs.py      # Discovery job lifecycle + SSE progress
│       ├── agent.py     # Analyst chat SSE endpoint
│       ├── present.py   # Presentation session management + SSE
│       ├── charts.py    # Chart CRUD + snapshot API
│       ├── dashboards.py# Dashboard CRUD + layout + refresh
│       ├── datasets.py  # Dataset (SQL) CRUD + execution
│       ├── sql_lab.py   # Raw SQL execution (execute_unlimited)
│       ├── catalog.py   # Semantic catalog read endpoints
│       ├── semantic.py  # SemanticModel CRUD
│       └── settings.py  # Per-tenant LLM/embedding settings
│
├── models/              # Pydantic domain models (TableMeta, SemanticModel, etc.)
├── storage/
│   ├── orm.py           # SQLAlchemy ORM classes (all tables)
│   ├── repositories/    # Async repo pattern (SemanticRepo, ChartRepo, etc.)
│   ├── database.py      # Async engine + session factory
│   ├── redis_client.py  # Redis connection (aioredis)
│   └── snapshot_cache.py# Chart snapshot read/write helpers
├── embeddings/
│   └── service.py       # EmbeddingService (OpenAI text-embedding-3-small)
├── semantic/            # Semantic layer helpers
└── config.py            # Pydantic Settings (env + .env file)
```
