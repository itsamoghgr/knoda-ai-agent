# Knoda.ai — System Architecture

## Overview

Knoda.ai is an agentic AI platform that acts as an autonomous data analyst. Three specialized LangGraph agents — **Discovery**, **Analyst**, and **Communication** — work together to catalog databases, answer data questions, and present insights in live meetings.

The system is a monorepo with a Python/FastAPI backend and a Next.js frontend, deployed on DigitalOcean App Platform (backend) and Vercel (frontend), with Supabase as the managed PostgreSQL + auth layer.

---

## Repository Layout

```
db_discovery_agent/
├── backend/                  # Python FastAPI application
│   ├── src/                  # Application source
│   │   ├── agents/           # LangGraph multi-agent layer
│   │   ├── api/              # FastAPI app, routers, dependencies
│   │   ├── config.py         # Pydantic settings (env vars)
│   │   ├── embeddings/       # OpenAI embedding service
│   │   ├── models/           # Pydantic data models
│   │   ├── query_engine/     # DuckDB connector + adapters
│   │   ├── semantic/         # dbt MetricFlow YAML serializer
│   │   ├── storage/          # SQLAlchemy ORM, repositories
│   │   └── tools/            # Agent tool implementations
│   ├── alembic/              # Database migrations
│   │   └── versions/         # 7 migration files
│   ├── pyproject.toml        # Python deps (uv)
│   └── .env.example
├── frontend/                 # Next.js 16 application
│   ├── src/
│   │   ├── app/              # App Router pages
│   │   ├── components/       # React components
│   │   └── lib/              # API clients, hooks, utilities
│   └── package.json
├── docker/
│   ├── Dockerfile.backend
│   └── docker-compose.yml    # Local dev (postgres + api)
├── .do/
│   └── app.yaml              # DigitalOcean App Platform spec
├── .github/workflows/ci.yml  # GitHub Actions (ruff lint)
├── HACKATHON_SUBMISSION.md
└── SYSTEM.md                 # This file
```

---

## Backend Architecture

### FastAPI Application

**Entry point:** `backend/src/api/main.py`

- Async FastAPI application with `lifespan` context manager
- Server-Sent Events (SSE) for real-time agent output streaming
- JWT auth validated via Supabase on every protected request
- `tenant_id` extracted from Supabase JWT and injected into all DB queries

### Source Directory Tree

```
src/
├── agents/
│   ├── agent.py            # Agent factory — builds supervisor or direct agent
│   ├── analyst.py          # Analyst agent (ReAct graph)
│   ├── communication.py    # Communication/presentation agent
│   ├── core.py             # AgentToolsContext + all shared tools
│   ├── discovery.py        # Discovery agent (ReAct graph)
│   ├── state.py            # AgentState TypedDict
│   └── supervisor.py       # LangGraph supervisor router
├── api/
│   ├── dependencies.py     # FastAPI DI (auth, db session, engine)
│   ├── main.py             # App factory + lifespan
│   └── routers/
│       ├── agent.py        # POST /agent — unified SSE endpoint
│       ├── catalog.py      # GET catalog, profiles, relationships
│       ├── charts.py       # Chart CRUD
│       ├── dashboards.py   # Dashboard CRUD + layout
│       ├── datasets.py     # Dataset CRUD + data fetch
│       ├── jobs.py         # Job CRUD + discovery trigger
│       ├── present.py      # TTS + presentation sessions
│       ├── semantic.py     # Semantic layer export/edit
│       ├── settings.py     # LLM config + business context
│       ├── sql_lab.py      # Raw SQL execution
│       └── usage.py        # Token usage stats
├── config.py               # Pydantic BaseSettings
├── embeddings/
│   └── service.py          # OpenAI text-embedding-3-small wrapper
├── models/
│   ├── connection.py       # SourceConfig enum (postgres/mysql/duckdb/s3)
│   ├── job.py              # Job, ProgressEvent
│   ├── profile.py          # ColumnProfile
│   ├── relationship.py     # Relationship
│   ├── schema.py           # TableMeta, ColumnMeta
│   └── semantic.py         # Entity, Dimension, Measure, SemanticModel
├── query_engine/
│   ├── engine.py           # QueryEngine (DuckDB, read-only enforcer)
│   └── adapters/
│       ├── postgres.py     # PostgreSQL → DuckDB ATTACH
│       ├── mysql.py        # MySQL → DuckDB ATTACH
│       ├── duckdb_file.py  # DuckDB file ATTACH
│       └── s3_parquet.py   # S3/Parquet → DuckDB
├── semantic/
│   └── serializer.py       # Serialize to dbt MetricFlow YAML
├── storage/
│   ├── database.py         # SQLAlchemy async engine + session factory
│   ├── source_config_cache.py  # In-memory cache for job source configs
│   ├── orm/
│   │   ├── charts.py
│   │   ├── embedding.py
│   │   ├── job.py
│   │   ├── profile.py
│   │   ├── relationship.py
│   │   ├── schema.py
│   │   ├── semantic.py
│   │   ├── settings.py
│   │   └── token_usage.py
│   └── repositories/
│       ├── charts_repo.py
│       ├── embedding_repo.py
│       ├── job_repo.py
│       ├── profile_repo.py
│       ├── relationship_repo.py
│       ├── schema_repo.py
│       ├── semantic_repo.py
│       ├── settings_repo.py
│       └── token_usage_repo.py
└── tools/
    ├── data.py             # SQL execution tools (execute_sql)
    └── schema.py           # Schema exploration tools (explore, describe)
```

### API Endpoints

Base path: `/api/v1`

**Health**
```
GET  /health                                    → {"status": "ok", "version": "..."}
GET  /connectors                                → Supported DB source types
```

**Agent**
```
POST /agent                                     → SSE stream (supervisor routes to Discovery or Analyst)
```

**Jobs**
```
POST   /jobs                                    → Create discovery job (202 Accepted, runs in background)
GET    /jobs                                    → List user's jobs
GET    /jobs/{job_id}                           → Job detail + progress counts
GET    /jobs/{job_id}/stream                    → SSE stream of live discovery progress
DELETE /jobs/{job_id}                           → Delete job and all associated data
PATCH  /jobs/{job_id}/source-config            → Update connection config
```

**Catalog**
```
GET  /jobs/{job_id}/catalog                    → Discovered tables + semantic classifications
GET  /jobs/{job_id}/profiles                   → Column profiling results
GET  /jobs/{job_id}/relationships              → FK relationship graph (nodes + edges)
```

**Semantic Layer**
```
GET   /jobs/{job_id}/semantic                  → Full semantic model as JSON
GET   /jobs/{job_id}/semantic.yaml             → Download dbt MetricFlow YAML
PATCH /jobs/{job_id}/semantic/dimensions/{id}  → Edit dimension definition
```

**Charts**
```
GET    /charts                                  → List user's charts
POST   /charts                                  → Create chart
GET    /charts/{chart_id}                       → Chart detail
PATCH  /charts/{chart_id}                       → Update chart
DELETE /charts/{chart_id}                       → Delete chart
```

**Dashboards**
```
GET    /dashboards                              → List user's dashboards
POST   /dashboards                              → Create dashboard
GET    /dashboards/{dashboard_id}               → Dashboard + all charts
PATCH  /dashboards/{dashboard_id}               → Update dashboard metadata
DELETE /dashboards/{dashboard_id}               → Delete dashboard
POST   /dashboards/{dashboard_id}/charts        → Add chart to dashboard
DELETE /dashboards/{dashboard_id}/charts/{id}   → Remove chart from dashboard
PATCH  /dashboards/{dashboard_id}/layout        → Save grid layout positions
```

**Datasets**
```
GET    /datasets                                → List datasets
POST   /datasets                                → Create dataset (SQL definition)
GET    /datasets/{dataset_id}                   → Dataset detail
PATCH  /datasets/{dataset_id}                   → Update dataset
DELETE /datasets/{dataset_id}                   → Delete dataset
GET    /datasets/{dataset_id}/data              → Execute dataset SQL, return rows
```

**SQL Lab**
```
POST /sql-lab                                   → Execute arbitrary SELECT (rows returned)
GET  /sql-lab/schema                            → Schema introspection for editor
```

**Presentation**
```
POST   /present/tts                             → Text-to-speech → MP3 audio bytes
POST   /present/{dashboard_id}/session          → Create presentation session
POST   /present/session/{session_id}/ask        → SSE stream: narration or Q&A answer
DELETE /present/session/{session_id}            → Clean up session
```

**Settings**
```
GET   /settings                                 → LLM provider config (all providers)
PATCH /settings                                 → Save provider config
PATCH /settings/activate                        → Switch active LLM provider
POST  /settings/test-llm                        → Validate provider credentials
GET   /settings/embedding                       → Embedding model config
PATCH /settings/embedding                       → Update embedding config
GET   /settings/business-context               → Business context text
PATCH /settings/business-context               → Update business context
```

**Usage**
```
GET /usage                                      → Token usage totals (input + output)
```

---

## Agent Architecture (LangGraph)

All agents are ReAct (Reason + Act) graphs built with LangGraph. Each loops: Think → call tool → observe → repeat until done.

### Supervisor

`backend/src/agents/supervisor.py`

Single LLM call that reads the user's message and routes to either the **Discovery** or **Analyst** agent. Does not execute any tools itself.

### Discovery Agent

`backend/src/agents/discovery.py`

**Purpose:** Exhaustively catalog every table in a connected database.

**Workflow:**
1. `explore_schema()` — list all databases, schemas, table names
2. `describe_table()` — get columns, types, PK/FK flags for each table
3. `execute_sql()` — sample rows (rare, only when type inference needs help)
4. `save_classification()` — persist semantic model (entity type, description, grain, dimensions, measures)
5. `save_relationships()` — persist detected FK relationships with confidence scores

**Constraint:** Must classify EVERY discovered table. No table is skipped.

### Analyst Agent

`backend/src/agents/analyst.py`

**Purpose:** Answer business data questions in plain English.

**Workflow:**
1. `get_semantic_catalog()` — load pre-built schema knowledge from AI Memory
2. `search_tables()` — semantic vector search for relevant tables
3. `describe_table()` — get column details for query construction
4. `execute_sql()` — run SELECT against live database
5. Optionally: `create_chart()`, `create_dashboard()`, `add_chart_to_dashboard()`

**Philosophy:** Semantic-first. Uses the cached catalog before touching the live database.

### Communication Agent

`backend/src/agents/communication.py`

**Purpose:** Join live meetings as a presenter — narrate dashboards with voice and answer audience questions.

**Workflow:**
- `get_dashboard_charts()` — auto-discovers the dashboard content
- Narrates each chart in plain English (no markdown, no SQL in output)
- `execute_sql()` for live data when answering follow-up questions
- Responds to verbal Q&A from the audience via browser STT → SSE → TTS pipeline

**Audio chain:**
- Browser: Web Speech API (STT) → sends transcript to backend
- Backend: agent answers → streams text → OpenAI TTS → MP3 bytes returned
- Frontend: single persistent `HTMLAudioElement` unlocked synchronously on "Start Presentation" click, reused by swapping `.src` (iOS WebKit autoplay fix)

### AgentToolsContext

`backend/src/agents/core.py`

```python
@dataclass
class AgentToolsContext:
    job_id: str
    engine: QueryEngine          # DuckDB read-only connector
    session_factory: Callable    # PostgreSQL async session
    tenant_id: str               # Supabase user UUID (multi-tenancy scope)
    alias_map: dict[str, str]    # source_id → human-readable alias
    tables_discovered: list[TableMeta]
    tables_total: int
    tables_saved: int
```

### Complete Tool List

| Tool | Agent(s) | Description |
|------|----------|-------------|
| `tool_explore_schema` | Discovery | List databases, schemas, table names |
| `tool_describe_table` | Discovery, Analyst | Column definitions, types, PKs, FKs |
| `tool_execute_sql` | All | Read-only SQL execution via DuckDB |
| `tool_save_classification` | Discovery | Persist semantic model to PostgreSQL |
| `tool_save_relationships` | Discovery | Persist FK relationship graph |
| `tool_get_semantic_catalog` | Analyst | Load all semantic models from AI Memory |
| `tool_search_tables` | Analyst | Vector similarity search over table embeddings |
| `tool_get_relationships` | Analyst | Retrieve relationship graph |
| `tool_create_chart` | Analyst | Save a new chart definition |
| `tool_list_charts` | Analyst | List user's existing charts |
| `tool_create_dashboard` | Analyst | Create a new dashboard |
| `tool_list_dashboards` | Analyst | List user's dashboards |
| `tool_add_chart_to_dashboard` | Analyst | Attach chart to dashboard |
| `tool_get_dashboard_charts` | Communication | Fetch all charts in a dashboard |
| `tool_list_databases` | All | List attached source databases |

---

## Query Engine (DuckDB)

`backend/src/query_engine/engine.py`

### How it works

An in-memory DuckDB connection serves as the universal query layer. External databases are **attached** in `READ_ONLY` mode — never modified. All LLM-generated SQL passes through this engine before execution.

### Three-Layer Read-Only Enforcement

1. **Driver level** — `ATTACH '...' AS alias (READ_ONLY)` — DuckDB physically cannot write to the source
2. **SQL parse level** — every query string is parsed by `sqlglot`; any non-`SELECT` statement is rejected before execution
3. **Result cap** — rows are limited to `MAX_ROWS_PER_QUERY` (default 1000); queries killed after `QUERY_TIMEOUT_SECONDS` (default 30s)

Any single layer independently blocks writes.

### Dialect Transpilation

LLMs generate SQL in PostgreSQL syntax (their training distribution). DuckDB has an incompatible dialect. `sqlglot.transpile(sql, read="postgres", write="duckdb")` runs at execution time, silently converting:
- `TO_CHAR(date, 'Mon YYYY')` → `strftime('%b %Y', date)`
- PostgreSQL-specific functions, casts, and operators

### Supported Sources

| Source | Adapter | Notes |
|--------|---------|-------|
| PostgreSQL | `adapters/postgres.py` | Attaches via DuckDB postgres_scanner |
| MySQL | `adapters/mysql.py` | Attaches via DuckDB mysql_scanner |
| DuckDB file | `adapters/duckdb_file.py` | Attaches local `.duckdb` file |
| S3/Parquet | `adapters/s3_parquet.py` | Reads Parquet from S3 via DuckDB |

### Thread Safety

A single-worker `ThreadPoolExecutor` ensures only one thread touches the DuckDB connection at a time. DuckDB's in-process model is not safe for concurrent access.

---

## AI Memory (pgvector)

`backend/src/storage/orm/embedding.py` · `backend/src/storage/repositories/embedding_repo.py`

### Purpose

After the Discovery Agent catalogs a database, it generates vector embeddings for every table and column. These embeddings are stored in PostgreSQL via the `pgvector` extension.

When the Analyst Agent receives a question, it performs a cosine similarity search over these embeddings to find the most relevant tables — without re-reading the source database.

### Implementation

- **Model:** OpenAI `text-embedding-3-small` (1536-dimensional vectors)
- **Storage:** `vector_embeddings` table with `tenant_id` scoping
- **Search:** `<=>` cosine distance operator via pgvector
- **Scope:** Per-tenant — embeddings from one user are never returned to another

### Why This Matters

The agent builds its knowledge once and retrieves it instantly on every subsequent question. It never re-discovers what it already knows, making responses faster and more accurate over time.

---

## Database Schema

**Migrations:** `backend/alembic/versions/`

### Migration History

| # | File | Purpose |
|---|------|---------|
| 0001 | `0001_initial_schema.py` | Core catalog: jobs, discovered_tables, discovered_columns, relationships, semantic_models, entities, dimensions, measures, column_profiles |
| 0002 | `0002_app_settings.py` | `app_settings` table: LLM provider config + business context |
| 0003 | `0003_job_source_config.py` | `source_config` JSONB column on jobs |
| 0004 | `0004_token_usage.py` | `token_usage` table: input/output token tracking per interaction |
| 0005 | `0005_embeddings.py` | `vector_embeddings` table with pgvector column |
| 0006 | `0006_charts_dashboards.py` | `charts`, `dashboards`, `datasets`, `dashboard_charts` junction |
| 0007 | `0007_multi_tenant.py` | `tenant_id` UUID column added to all tables |

### Key Tables

**`jobs`** — Discovery job state
- `id`, `tenant_id`, `status` (pending/running/done/failed), `source_type`
- `tables_total`, `tables_processed`, `error_message`
- `source_config` JSONB — encrypted connection params

**`discovered_tables`** — Schema catalog
- `id`, `tenant_id`, `job_id`
- `database_name`, `schema_name`, `table_name`
- `row_count`, `description`

**`discovered_columns`** — Column metadata
- `table_id`, `column_name`, `column_type`, `nullable`
- `is_primary_key`, `is_foreign_key`

**`semantic_models`** — AI classification
- `table_id`, `tenant_id`
- `table_type` (fact/dimension/bridge), `description`, `grain`

**`entities` / `dimensions` / `measures`** — Semantic components
- Nested under `semantic_models`
- LLM-inferred business meaning for each column

**`relationships`** — FK graph
- `from_table_id`, `to_table_id`, `from_column`, `to_column`
- `confidence` (0–1), `source` (inferred/detected)

**`column_profiles`** — Data profiling stats
- `distinct_count`, `null_count`, `min`, `max`, `data_type_dist`

**`vector_embeddings`** — AI Memory
- `tenant_id`, `object_type` (table/column), `object_id`
- `embedding` vector(1536)

**`app_settings`** — LLM configuration
- `tenant_id`, `active_provider`
- `providers` JSONB — API keys and model names per provider
- `business_context` text

**`token_usage`** — Cost tracking
- `tenant_id`, `interaction_type`, `input_tokens`, `output_tokens`

**`charts`** — Saved visualizations
- `tenant_id`, `title`, `chart_type`, `definition` JSONB
- `dataset_id` FK

**`dashboards`** — Dashboard metadata
- `tenant_id`, `title`, `layout` JSONB (React Grid Layout positions)

**`dashboard_charts`** — Junction table
- `dashboard_id`, `chart_id`

**`datasets`** — Virtual tables
- `tenant_id`, `name`, `sql_definition`, `job_id`

### Multi-Tenancy

Every table has a `tenant_id UUID` column populated from the Supabase JWT `sub` claim. All repository methods filter by `tenant_id` — a user can never read or write another user's data.

---

## Frontend Architecture

### Tech Stack

| Layer | Library |
|-------|---------|
| Framework | Next.js 16.1.7 (App Router) |
| React | 19.2.3 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Charts | ECharts + Recharts |
| Diagrams | React Flow (relationship graph) |
| Dashboard layout | React Grid Layout |
| Data fetching | TanStack Query |
| State | Zustand |
| Auth | @supabase/ssr |
| Animations | Framer Motion |
| Fonts | Geist (sans/mono) + Syne (display) |

### App Routes

```
src/app/
├── page.tsx                          # Public landing page (/)
├── layout.tsx                        # Root layout + font definitions
├── auth/
│   ├── login/page.tsx                # Login form
│   ├── signup/page.tsx               # Signup form
│   └── callback/route.ts             # Supabase OAuth callback
├── overview/page.tsx                 # App dashboard (protected)
├── databases/page.tsx                # Connection management (protected)
├── jobs/
│   ├── new/page.tsx                  # Create discovery job
│   └── [id]/
│       ├── page.tsx                  # Job detail + live progress
│       ├── catalog/page.tsx          # Discovered tables browser
│       ├── profiles/page.tsx         # Column profiling
│       ├── relationships/page.tsx    # FK graph (React Flow)
│       └── semantic/page.tsx         # Semantic layer editor
├── chat/page.tsx                     # AI Assistant (Analyst agent)
├── sql-lab/page.tsx                  # Raw SQL editor
├── charts/
│   ├── page.tsx                      # Charts gallery
│   ├── new/page.tsx                  # Create chart
│   └── [id]/page.tsx                 # Chart detail
├── dashboards/
│   ├── page.tsx                      # Dashboards gallery
│   ├── [id]/page.tsx                 # Dashboard builder (drag-and-drop)
│   └── [id]/present/page.tsx         # Presentation mode + TTS
└── settings/page.tsx                 # LLM config, token usage, business context
```

### Auth Flow

```
Request → proxy.ts (Next.js middleware equivalent)
  ├── / (landing) → public, serve as-is
  │     └── if authenticated → redirect /overview
  ├── /auth/* → public, serve as-is
  └── everything else → require Supabase session
        └── if no session → redirect /auth/login?next=<original-path>

After login → LoginForm reads `next` param → router.push(next || "/overview")
```

**Key file:** `frontend/src/proxy.ts` — exported as `proxy` function (Next.js 16 convention).

### Component Structure

```
src/components/
├── layout/
│   ├── app-shell.tsx          # Wraps protected pages; conditionally renders sidebar
│   └── sidebar.tsx            # Nav links, theme toggle, sign-out
├── ui/                        # shadcn/ui primitives (Button, Input, Dialog, etc.)
├── chat/                      # Message list, streaming output, chart inline rendering
├── charts/                    # Chart editor form, ECharts/Recharts renderer
├── dashboards/                # Dashboard grid, chart tiles, layout persistence
├── catalog/                   # Table browser, column list
├── relationships/             # React Flow graph with FK edges
├── profiles/                  # Column stats tables
├── semantic/                  # Semantic model editor
├── jobs/                      # Job status badge, progress bar, log stream
├── settings/                  # LLM provider panels, token usage display
└── presentation/              # Presentation slide controller, TTS audio player
```

---

## Environment Variables

**Backend** (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection (Supavisor pooler, port 6543) |
| `ALEMBIC_DATABASE_URL` | No | Direct DB URL for migrations (bypasses pooler if needed) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key for auth verification |
| `CORS_ORIGINS` | Yes | JSON array of allowed frontend origins |
| `LLM_PROVIDER` | No | Default: `openai` |
| `LLM_MODEL` | No | Default: `gpt-4o` |
| `LLM_API_KEY` | No | Set via UI Settings page |
| `MAX_ROWS_PER_QUERY` | No | Row cap per SQL execution (default: 1000) |
| `QUERY_TIMEOUT_SECONDS` | No | Query kill timeout (default: 30) |
| `MAX_SAMPLE_ROWS` | No | Rows sampled per table during discovery (default: 10) |
| `MAX_CONCURRENT_TABLE_TASKS` | No | Parallel table classification tasks (default: 10) |
| `API_HOST` | No | Uvicorn bind host (default: 0.0.0.0) |
| `API_PORT` | No | Uvicorn port (default: 8000) |

**Frontend** (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (public) |
| `NEXT_PUBLIC_API_URL` | Yes | Backend base URL (e.g. `https://api.knoda.itsamoghgr.com`) |

---

## Deployment

### Production Stack

| Component | Service | Notes |
|-----------|---------|-------|
| Backend API | DigitalOcean App Platform | 1 uvicorn worker (in-memory session store limitation) |
| Frontend | Vercel | Next.js managed deployment |
| Database | Supabase | PostgreSQL 16 + pgvector + auth |
| Container | Docker | `docker/Dockerfile.backend` |

### DigitalOcean App Spec (`.do/app.yaml`)

- **Instance:** `apps-s-1vcpu-2gb` (2 GB RAM for LangGraph agent context)
- **Health check:** `GET /api/v1/health` every 30s
- **Workers:** 1 (pinned to prevent in-memory presentation session loss across workers)

### Supabase Connection

DigitalOcean App Platform is IPv4-only. Supabase's direct connection is IPv6-only. Resolution:

- **Use Supavisor transaction pooler** on port `6543` (IPv4-compatible)
- Set `statement_cache_size=0` in SQLAlchemy connect args (transaction mode doesn't support prepared statements)
- Same fix applied to Alembic's engine in `alembic/env.py`

### Local Development

```bash
# Start PostgreSQL + backend
cd docker && docker-compose up

# Or run backend directly
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn api.main:create_app --factory --reload

# Frontend
cd frontend
npm install
npm run dev
```

---

## Key Design Decisions

1. **DuckDB as universal query layer** — All source databases are attached to an in-memory DuckDB connection. This gives a single, consistent SQL interface across PostgreSQL, MySQL, DuckDB files, and S3/Parquet without running migrations or installing source-specific drivers in the agent layer.

2. **Three-layer read-only enforcement** — Source data safety is enforced at the driver level (DuckDB `READ_ONLY` attach), the SQL parse level (sqlglot rejects non-SELECT), and the result level (row cap + timeout). Three independent guards; any one blocks a write.

3. **sqlglot dialect transpilation over prompt engineering** — Telling the LLM "write DuckDB SQL" helps, but `sqlglot.transpile(read="postgres", write="duckdb")` catches what the prompt misses — deterministically, every time.

4. **Semantic-first query planning** — The Analyst Agent always loads the pre-built AI Memory catalog before touching the live database. This makes question answering faster (vector search over indexed embeddings vs. live schema queries) and more accurate (LLM has full context before writing SQL).

5. **Persistent AI Memory (pgvector)** — The agent builds its knowledge graph once during Discovery and retrieves it instantly on every subsequent question. This is what makes the agent feel like a colleague rather than a search engine — it already knows your data model.

6. **Repository pattern over raw ORM** — All database access goes through typed repository classes (`storage/repositories/`). This isolates query logic from agent/API logic and makes `tenant_id` scoping enforced in one place.

7. **Multi-tenancy via tenant_id column** — All tables are tenant-scoped at the data layer. The `tenant_id` is extracted from the Supabase JWT on every request and injected into all repository calls. No cross-tenant data leaks are possible even if the API layer has a bug.

8. **SSE for real-time streaming** — Agent responses and discovery progress are streamed via Server-Sent Events. The frontend opens a persistent connection and renders tokens/events as they arrive. No polling; no WebSockets to manage.

9. **LangGraph ReAct graphs over sequential chains** — Each agent is a stateful graph that can call tools, observe results, and decide its next action in a loop. This is essential for tasks like discovery (unknown number of tables) and analyst Q&A (may need multiple SQL iterations to get the right answer).

10. **Single uvicorn worker** — Presentation sessions are stored in-process memory (ephemeral by design — a session lasts one meeting). Multiple workers would cause load-balancer routing to break sessions. Single-worker is the correct trade-off at current scale; the path to multi-worker is moving session state to Redis.
