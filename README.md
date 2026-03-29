# Knoda.ai

**An open-source, agentic data intelligence platform. Connect your database. The AI does the rest.**

---

## What is Knoda.ai?

Knoda.ai is an autonomous AI data analyst. You connect your database once, and the agent maps everything — the schema, the relationships, the business meaning of every table and column. From that point forward, anyone on your team can ask questions in plain English, get charts and dashboards built, and have the AI present data insights in live meetings — without writing SQL, without waiting for an analyst.

The goal is not a smarter BI tool. The goal is an agent that works the way a data analyst works: it understands your data, holds context over time, and takes action autonomously.

---

## Features

**Autonomous Discovery**
- Connect PostgreSQL, MySQL, DuckDB, or S3/Parquet sources in read-only mode
- The agent explores every table, samples data, infers relationships, and classifies each table as a business entity (Orders, Users, Revenue, Events)
- Real-time visibility into every step — tool calls and agent reasoning streamed live

**AI Memory**
- Every discovery is saved permanently: catalog, semantic layer, relationships, vector embeddings
- Embeddings built with OpenAI `text-embedding-3-small` + pgvector — the agent finds the right tables by meaning, not just name
- Business context storage: company description, revenue definition, fiscal year, key KPIs

**Analyst Agent**
- Ask any business question in plain English — the agent finds the right tables, writes SQL, runs it, and answers
- Semantic-first: reads from AI Memory before touching the live database
- Builds charts (bar, line, area, pie, KPI, table) and full dashboards from a single instruction
- Supports Anthropic, OpenAI, Groq, and Ollama

**Communication Agent — Presentation Mode**
- Open any dashboard in Presentation Mode
- The agent autonomously narrates each chart with key insights and speaks to the audience
- Audience members ask questions verbally — the agent answers in real time using live data
- Barge-in support: interrupt mid-speech with Space bar or the mic button
- Server-side session keeps full meeting conversation memory
- Powered by Web Speech API (STT) and OpenAI TTS

**SQL Lab**
- Write and run raw SQL against any connected database
- "Ask AI" button to construct or explain queries; the result is pasted directly into the editor

**Multi-LLM + Token Tracking**
- Store multiple LLM provider configs; one active at a time, switch any time
- Full token usage tracking per interaction

---

## How It Works

1. **Connect** — add your database credentials. Knoda connects in strict read-only mode.
2. **Discover** — click Run Discovery. The agent autonomously explores every table, classifies the schema, infers relationships, and builds AI Memory. Takes ~2 minutes for a 10–50 table database.
3. **Ask** — open AI Chat and ask anything in plain English. The agent reasons, picks the right tables, writes SQL, and answers.
4. **Build** — tell the agent to create a chart or dashboard. It writes the queries, renders the charts, and arranges the layout.
5. **Present** — open any dashboard in Presentation Mode. The Communication Agent narrates the data to your audience and handles live verbal Q&A.

---

## Quickstart

### Prerequisites

- Python 3.11+, [uv](https://docs.astral.sh/uv/)
- Node.js 18+
- PostgreSQL (for AI Memory storage)

### Backend

```bash
cd backend

# Install dependencies
uv sync

# Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and your LLM provider key

# Run database migrations
uv run alembic upgrade head

# Start the API server
uv run uvicorn api.main:create_app --factory --reload --port 8000
```

The API will be available at `http://localhost:8000`.

**Minimum `.env` configuration:**

```env
# PostgreSQL for AI Memory
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/knoda

# LLM provider (openai | anthropic | groq | ollama)
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-your-key-here
LLM_MODEL=claude-sonnet-4-5
```

LLM providers can also be configured through the Settings UI after starting — no restart required.

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

---

## Supported Data Sources

| Source | Status |
|--------|--------|
| PostgreSQL (incl. Supabase, RDS, Cloud SQL) | Supported |
| MySQL | Supported |
| DuckDB file | Supported |
| S3 / Parquet | Supported |

All sources are connected in **read-only mode**. Knoda cannot modify your data.

---

## Tech Stack

**Backend:** FastAPI · LangGraph · DuckDB · SQLAlchemy · Alembic · PostgreSQL · pgvector · uv

**Frontend:** Next.js 15 · shadcn/ui · Tailwind CSS · ECharts · TanStack Query · Zustand

**AI:** Anthropic · OpenAI · Groq · Ollama · OpenAI TTS · Web Speech API

---

## Further Reading

- [`idea.md`](idea.md) — the vision, what we are building, and where this is headed
- [`architecture.md`](architecture.md) — full system architecture with component diagrams and an end-to-end user flow example

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
