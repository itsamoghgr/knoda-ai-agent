# Knoda.ai — System Architecture

---

## High-Level Overview

Knoda.ai is organized into four main layers that work together:

```
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND  (Next.js)                                                 │
│  What the user sees and interacts with                               │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  REST API + Server-Sent Events (SSE)
┌────────────────────────────▼─────────────────────────────────────────┐
│  BACKEND API  (FastAPI)                                              │
│  Handles all requests, orchestrates agents and storage               │
└────┬──────────────────────────────────────────────┬──────────────────┘
     │                                              │
┌────▼────────────────────────┐      ┌─────────────▼──────────────────┐
│  AI AGENT LAYER  (LangGraph)│      │  QUERY ENGINE  (DuckDB)        │
│  Three autonomous ReAct     │      │  Read-only connector to all    │
│  agents with tool access    │      │  external databases            │
└────┬────────────────────────┘      └────────────────────────────────┘
     │
┌────▼────────────────────────────────────────────────────────────────┐
│  AI MEMORY  (PostgreSQL + pgvector)                                  │
│  Everything the AI knows about your data — persisted across sessions │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — Frontend (Next.js)

The frontend is a single-page application. It communicates with the backend over REST and streams real-time agent output via Server-Sent Events (SSE).

### Pages and Their Purpose

| Page | Purpose |
|------|---------|
| **Databases** | Connect, manage, and delete database connections. Trigger discovery. |
| **Discovery Progress** | Watch the AI agent's step-by-step thinking as it discovers a database live. Shows tool calls, reasoning, and results in real time. |
| **Catalog** | Browse every discovered table — columns, data types, sample values, and inferred relationships. Includes a visual graph showing how tables connect. |
| **AI Memory** | View the semantic classification — entities, dimensions, measures, and the relationship map the AI built. |
| **AI Chat** | Conversational interface. Ask any question in plain English. The agent's full reasoning is visible — every tool call and result is shown. |
| **SQL Lab** | Write and run raw SQL against any connected database. Includes an "Ask AI" button to help construct queries. |
| **Charts** | Browse and manage all saved charts. |
| **Dashboards** | Build and view dashboards. Supports drag-and-drop layout. Includes a Present button. |
| **Presentation Mode** | Full-screen dashboard view with the Communication Agent. Narrates the dashboard aloud and handles live voice Q&A. |
| **Settings** | Configure LLM providers (multiple, one active at a time), view token usage, and set up AI Memory (embeddings API key, business context). |

### How the Frontend Communicates

- **REST** — for all CRUD operations (databases, charts, dashboards, settings)
- **SSE (Server-Sent Events)** — for all agent interactions. The agent streams tokens, tool calls, and results back to the browser in real time. No polling.
- **Web Speech API** — for speech-to-text in Presentation Mode (browser-native, no external service)
- **Audio playback** — for TTS output in Presentation Mode (MP3 blobs from the backend)

---

## Layer 2 — Backend API (FastAPI)

The backend is a FastAPI application. It is stateless (except for the in-memory presentation session store) and delegates intelligence to the AI Agent Layer and storage to AI Memory.

### API Routers

| Router | Endpoints | Responsibility |
|--------|-----------|---------------|
| `/jobs` | CRUD + discovery trigger | Manage database connections and run discovery |
| `/agent` | `POST /agent` (SSE) | Unified AI endpoint — all chat and discovery requests go here |
| `/present` | Session + TTS endpoints | Communication Agent sessions and text-to-speech |
| `/datasets` | CRUD + data fetch | Dataset management and SQL execution for charts |
| `/charts` | CRUD | Chart creation and management |
| `/dashboards` | CRUD | Dashboard and chart layout management |
| `/catalog` | Read | Serve discovered tables and columns |
| `/semantic` | Read | Serve AI Memory (entities, measures, dimensions) |
| `/relationships` | Read | Serve discovered table relationships |
| `/settings` | CRUD | LLM provider config, business context, embeddings key |
| `/token-usage` | Read | Token consumption history |

### The Unified Agent Endpoint

All AI interactions — both discovery and analytics — flow through a single endpoint: `POST /api/v1/agent`.

The backend builds a `QueryEngine`, attaches the relevant database(s), creates a shared `AgentToolsContext`, builds the LangGraph Supervisor, and starts streaming events back via SSE. The supervisor decides which agent handles the request.

### Presentation Session Store

Presentation Mode uses a separate set of endpoints under `/present`. An in-memory session store holds:
- Which dashboard is being presented
- The full conversation history for the meeting

Sessions are created when entering Presentation Mode and deleted when the page is closed.

---

## Layer 3 — AI Agent Layer (LangGraph)

All agents follow the same ReAct pattern: **Think → Act → Observe → Repeat** until the task is complete. No agent has hardcoded workflows — each one decides which tools to call based on the task and what it observes.

### How Agents Are Organized

```
                    User Message
                         │
                         ▼
              ┌──────────────────────┐
              │     SUPERVISOR       │
              │  (one LLM call to    │
              │   decide routing)    │
              └────────┬─────────────┘
                       │
           ┌───────────┴────────────┐
           │                        │
           ▼                        ▼
  ┌─────────────────┐    ┌──────────────────┐
  │ DISCOVERY AGENT │    │  ANALYST AGENT   │
  │                 │    │                  │
  │ Explores and    │    │ Answers business  │
  │ catalogs a      │    │ questions, builds │
  │ database        │    │ charts and        │
  │                 │    │ dashboards        │
  └─────────────────┘    └──────────────────┘

  ┌──────────────────────────────────────────┐
  │         COMMUNICATION AGENT              │
  │  (separate — not routed through          │
  │   Supervisor, has its own session)       │
  │                                          │
  │  Presents dashboards, answers live       │
  │  verbal questions during meetings        │
  └──────────────────────────────────────────┘
```

### Discovery Agent

**When activated:** When the user triggers discovery on a newly connected database.

**What it does:** Explores the full schema autonomously — reads every table, samples the data, infers relationships between tables, classifies each table as a business entity (Orders, Users, Products, Events...), identifies what each column measures or describes, and saves all of this to AI Memory.

**Tools available:**
- Explore schema (list all tables and schemas)
- Describe table (get column details)
- Execute SQL (sample data, check distributions)
- Save table classification (write to AI Memory)
- Save relationships (write to AI Memory)
- Build and save semantic model (entities, dimensions, measures)
- Create embeddings (vector representation of each table for semantic search)

### Analyst Agent

**When activated:** All user chat requests, SQL generation, and chart/dashboard creation.

**What it does:** Answers business questions by reading AI Memory first, then querying the live database only when actual data values are needed. Builds charts and dashboards autonomously when asked.

**Tool hierarchy (semantic-first principle):**
1. `get_semantic_catalog` — always called first; reads the full knowledge base from AI Memory
2. `search_tables` — semantic search to find the most relevant tables for a question
3. `describe_table` — get exact column names for SQL construction
4. `get_relationships` — find join paths between tables
5. `execute_sql` — run a live query against the database
6. `create_chart`, `create_dashboard`, `add_chart_to_dashboard` — build visualizations
7. `list_charts`, `list_dashboards`, `get_dashboard_charts` — inspect existing work

### Communication Agent

**When activated:** When a dashboard is opened in Presentation Mode.

**What it does:** Acts as a live meeting presenter. It discovers what is on the dashboard autonomously via tools, narrates each chart with key business insights, and answers audience questions conversationally using live data when needed.

**Key behavior:**
- On session start: calls `get_dashboard_charts` to discover what the audience can see, then narrates
- During Q&A: decides whether to answer from memory or fetch fresh data via SQL
- Maintains full meeting history server-side — audience can ask follow-up questions naturally
- No chart creation tools — it presents, it does not build

**Tools available:**
- `get_dashboard_charts` — discover what is on the current dashboard
- `get_semantic_catalog` — understand the schema
- `search_tables`, `describe_table`, `get_relationships` — for SQL construction
- `execute_sql` — live data queries when needed
- `list_databases` — verify database aliases

---

## Layer 4 — AI Memory (PostgreSQL + pgvector)

AI Memory is what separates Knoda from a generic SQL chatbot. It is the accumulated knowledge the AI builds about your data and your business. Without it, every request starts from scratch. With it, the AI gets faster and more accurate over time.

### What Is Stored

| Component | What it holds | How it is used |
|-----------|--------------|----------------|
| **Jobs** | Database connection details, discovery status, timing metadata | Reconnect to databases, track which databases have been discovered |
| **Catalog** | Every discovered table and column — name, type, nullable, primary key, sample values | The AI knows what data exists without scanning the database on every request |
| **Semantic Layer** | Business entities (User, Order, Product...), dimensions (date, category, status), measures (revenue, count, quantity), table descriptions and grain | The AI understands what data *means*, not just that it exists |
| **Relationships** | Foreign key and inferred relationships between tables, with explicit join paths | The AI can write correct JOINs without trial and error |
| **Vector Embeddings** | 1536-dimension text embeddings for every table (OpenAI `text-embedding-3-small`, stored via pgvector) | Semantic search — "show me revenue data" finds the right tables by meaning, not just keyword matching |
| **Charts** | Saved chart definitions — name, type, SQL query, axis config, dataset | The AI knows what has been built and can reference or add to existing charts |
| **Dashboards** | Dashboard layouts and chart placements | The AI can present, update, or build on existing dashboards |
| **Business Context** | Company description, revenue definition, fiscal year, key metrics, currency | Every AI response is contextualized to the specific business, not generic data |
| **App Settings** | LLM provider configurations (multiple, one active) | The backend always uses the correct LLM without hardcoding |
| **Token Usage** | Input and output token counts per interaction, by provider and model | Track AI costs over time |

---

## Query Engine (DuckDB)

The Query Engine is how the AI touches your data. It uses DuckDB's `ATTACH` mechanism to connect to external databases in strict read-only mode.

**How it works:**
1. When a request needs live data, a new DuckDB in-memory instance is created
2. The target database is ATTACHed as a read-only source with a deterministic alias (e.g., `src0`)
3. All SQL queries use fully-qualified names: `alias.schema.table` (e.g., `src0.public.orders`)
4. Multiple databases can be attached simultaneously — the AI can query across them in a single session
5. The instance is discarded after the request

**Supported sources:**
- PostgreSQL (including Supabase, AWS RDS, etc.)
- MySQL
- DuckDB file databases
- S3 Parquet files (data lakes)

**Safety layers:**
- DuckDB `ATTACH READ_ONLY` — prevents any writes at the engine level
- `sqlglot` query validation — rejects non-SELECT statements before execution
- SQL sanitization — strips semicolons and multi-statement attempts from LLM-generated SQL

---

## External Services

| Service | Used for | Required |
|---------|---------|---------|
| Anthropic (Claude) | LLM for all agent reasoning | One of the LLM options |
| OpenAI (GPT) | LLM for all agent reasoning | One of the LLM options |
| Groq | LLM for all agent reasoning | One of the LLM options |
| Ollama | Local LLM | One of the LLM options |
| OpenAI `text-embedding-3-small` | Building vector embeddings during discovery | Required for semantic table search |
| OpenAI TTS (`tts-1`) | Text-to-speech for Presentation Mode | Required for voice narration |
| Web Speech API | Speech-to-text for Presentation Mode | Browser-native, no API key needed |

---

## End-to-End User Flow Example

**Scenario:** A startup's head of operations wants to understand the business's sales performance without asking an engineer.

---

**Step 1 — Connect the Database**

The operations manager opens Knoda.ai and goes to the Databases page. She enters the company's PostgreSQL connection details. Knoda validates the connection and saves it.

---

**Step 2 — Run Discovery**

She clicks "Run Discovery." The Discovery Agent starts immediately, and she watches it work in real time on the Discovery Progress page:

```
→ Exploring schema...
    Tool: explore_schema
    Found 12 tables across 2 schemas

→ Describing tables...
    Tool: describe_table (orders)
    Tool: describe_table (users)
    Tool: describe_table (products)
    ... (9 more)

→ Analyzing data samples...
    Tool: execute_sql
    "orders has 847,000 rows, date range 2021–2024"

→ Inferring relationships...
    "orders.user_id → users.id (FK detected)"
    "order_items.order_id → orders.id (FK detected)"

→ Classifying tables...
    "orders → fact table (Order entity)"
    "users → dimension table (Customer entity)"
    "products → dimension table (Product entity)"

→ Saving to AI Memory...
→ Building embeddings...
→ Discovery complete.
```

The full database has been understood in about 2 minutes. She never wrote a line of SQL.

---

**Step 3 — Explore the Catalog**

She opens the Catalog page and sees every table mapped out — column types, sample data, and a visual graph showing how the 12 tables connect to each other. She can see at a glance that `orders` is the central fact table, connected to `users`, `products`, `promotions`, and `shipping`.

---

**Step 4 — Ask a Question**

She goes to AI Chat and types: *"What was our total revenue last quarter, broken down by product category?"*

The Analyst Agent responds:

```
→ Tool: get_semantic_catalog
  Reading AI Memory... found orders, order_items, products tables

→ Tool: search_tables("revenue by product category")
  Most relevant: orders (total_amount), order_items (quantity, unit_price),
  products (category)

→ Tool: execute_sql
  SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM src0.public.order_items oi
  JOIN src0.public.orders o ON oi.order_id = o.id
  JOIN src0.public.products p ON oi.product_id = p.id
  WHERE o.created_at >= DATE_TRUNC('quarter', CURRENT_DATE - INTERVAL '3 months')
    AND o.created_at < DATE_TRUNC('quarter', CURRENT_DATE)
  GROUP BY p.category ORDER BY revenue DESC

  Results:
  Electronics    $1,240,000
  Apparel          $890,000
  Home & Garden    $430,000
  ...

→ Electronics led with $1.24M (42% of total). Apparel was second at $890K.
```

---

**Step 5 — Build a Dashboard**

She types: *"Create a Q4 sales dashboard with revenue by category, monthly trend, and top 10 customers."*

The Analyst Agent:
1. Writes and validates three SQL queries
2. Creates three charts (bar chart, line chart, table)
3. Creates a new dashboard "Q4 Sales Overview"
4. Adds all three charts to the dashboard

She navigates to the dashboard and sees a clean grid layout with all three visualizations, already populated with live data.

---

**Step 6 — Present in a Meeting**

The next morning she has a leadership meeting. She opens the dashboard and clicks **Present**.

The Communication Agent takes over:

1. It calls `get_dashboard_charts` to discover what is on the dashboard
2. It begins narrating: *"Good morning everyone. Today I want to walk you through our Q4 Sales Overview. Let's start with the revenue breakdown by category..."*
3. The CEO interrupts and asks verbally: *"Wait — how does Electronics compare to the same quarter last year?"*
4. She presses Space bar to interrupt. The agent stops speaking immediately.
5. She speaks: *"How does Electronics compare to Q4 last year?"*
6. The agent thinks, runs a SQL query against the live database, and responds: *"Electronics revenue in Q4 last year was $980,000, so we are up 27% year over year — strong growth driven largely by the new product lines launched in October."*
7. The meeting continues. The agent answers follow-up questions, always maintaining context of the full conversation.

When she presses X to close the presentation, all audio stops immediately and the session is cleaned up.

---

## Data Flow Summary

```
User types a question
        │
        ▼
  POST /api/v1/agent  (SSE)
        │
        ▼
  Supervisor LLM call
  "Is this discovery or analytics?"
        │
        ├── Discovery → Discovery Agent
        │                    │
        │                    ├── explore_schema (DuckDB)
        │                    ├── describe_table (DuckDB)
        │                    ├── execute_sql (DuckDB)
        │                    └── save to AI Memory (PostgreSQL)
        │
        └── Analytics → Analyst Agent
                             │
                             ├── get_semantic_catalog (AI Memory)
                             ├── search_tables (pgvector similarity search)
                             ├── execute_sql (DuckDB → live database)
                             └── create_chart / create_dashboard (AI Memory)

                     All steps stream back to frontend via SSE
                     (token by token, tool call by tool call)
```

---

*Frontend: Next.js · shadcn/ui · Tailwind CSS · ECharts · react-grid-layout*
*Backend: FastAPI · LangGraph · DuckDB · SQLAlchemy · Alembic*
*Storage: PostgreSQL · pgvector*
*AI: Anthropic · OpenAI · Groq · Ollama · OpenAI TTS · Web Speech API*
