# Knoda.ai — LovHack Season 2 Submission

---

## Inspiration

Every data team I've talked to has the same problem: business teams are drowning in questions they can't answer themselves, and analysts are drowning in repetitive work that shouldn't require a human.

The bottleneck is always the same. A RevOps lead wants to know churn by region this quarter. They open a ticket. The analyst picks it up two days later, writes the SQL, builds the chart, pastes it into a slide, and joins the meeting to present it. By the time the insight lands, the moment to act has already passed.

I built Knoda.ai because I believe the answer isn't a better BI tool — it's an agent that already knows your data, can answer questions instantly, and shows up to your meetings.

---

## What It Does

Knoda.ai is an agentic AI platform that acts as an autonomous data analyst for business and data teams. Three agents work together:

**1. Discovery Agent**
Connects to your database (PostgreSQL, MySQL, DuckDB, S3/Parquet) in read-only mode, maps the entire schema, infers relationships between tables, and classifies every table into business entities — Orders, Users, Revenue, Events. It builds **AI Memory**: a persistent semantic knowledge layer backed by PostgreSQL + pgvector that stores everything it learns. The agent never starts from scratch.

**2. Analyst Agent**
Answers questions in plain English. When you ask "What was our revenue last month?", the agent searches AI Memory to understand your data model, writes the SQL, runs it against your live database, and returns the answer — as a number, a chart, or a full dashboard. It reasons step-by-step and builds persistent charts and dashboards you can revisit.

**3. Communication Agent**
Joins your live meetings as a participant. It presents your dashboards with voice narration, walks through each chart with contextual insights, and answers verbal questions from the audience in real time using live data. Before the call ends, it has already queued the follow-up charts someone asked for.

---

## How We Built It

**Backend**
- **FastAPI** — async REST API with Server-Sent Events for agent streaming
- **LangGraph** — multi-agent orchestration (Discovery, Analyst, Communication agents as stateful ReAct graphs)
- **DuckDB** — in-memory query engine; external databases attached in `READ_ONLY` mode, so we never write to source data
- **sqlglot** — SQL dialect transpilation (LLM-generated PostgreSQL syntax auto-converted to DuckDB dialect at execution time)
- **PostgreSQL + pgvector** — persistent storage for AI Memory: semantic catalog, table embeddings, relationship graph, and conversation history
- **OpenAI / Anthropic** — configurable LLM backend; the agent reasons, writes SQL, and narrates

**Frontend**
- **Next.js 16 + React 19** — App Router, server components, streaming
- **Tailwind CSS + shadcn/ui** — component system
- **Supabase Auth** — authentication with SSR session management
- **ECharts + Recharts** — chart rendering
- **React Grid Layout** — drag-and-drop dashboard builder
- **Framer Motion** — landing page animations

**Infrastructure**
- Deployed on **DigitalOcean App Platform** (backend) + **Vercel** (frontend)
- **Supabase** — managed PostgreSQL with pgvector extension
- **Alembic** — database migrations

---

## Challenges We Ran Into

**DuckDB dialect incompatibility**
The LLM writes SQL in PostgreSQL syntax (it's what it's trained on), but DuckDB doesn't support PostgreSQL-specific functions like `TO_CHAR()`. We solved this elegantly: sqlglot transpiles every SELECT query from `postgres` → `duckdb` dialect at execution time, silently converting `TO_CHAR(date, 'Mon YYYY')` to `strftime('%b %Y', date)` and handling dozens of other dialect differences automatically.

**iOS audio autoplay restrictions**
The Communication Agent narrates dashboards aloud. WebKit on iOS requires audio to be triggered synchronously inside a user gesture — but we were crossing async boundaries before calling `.play()`. The fix was architectural: one persistent `HTMLAudioElement` created on mount, unlocked synchronously in the "Start Presentation" button click before any `await`, then reused for all narration by swapping `.src` rather than creating new instances.

**Supabase connection pooler + asyncpg prepared statements**
DigitalOcean's App Platform is IPv4-only; Supabase's direct connection is IPv6. The transaction pooler (port 6543) routes over IPv4 but doesn't support asyncpg's prepared statement cache. Required `statement_cache_size=0` in SQLAlchemy's connect args — and discovering that Alembic creates its own engine at migration time and needed the same fix separately.

**Real-time streaming across multiple workers**
Presentation sessions held in-process memory were lost when the load balancer routed requests to different workers. Solved by pinning to a single uvicorn worker and adding a TTL-based session cleanup task.

---

## Accomplishments That We're Proud Of

- **AI Memory that actually persists** — the agent builds a semantic knowledge graph of your database on first run and gets meaningfully smarter with each query. It never re-discovers what it already knows.
- **Three-layer read-only enforcement** — we take data safety seriously. Every source is attached with `READ_ONLY` at the DuckDB driver level, every SQL string is parsed by sqlglot to reject anything that isn't a SELECT, and results are row-capped. Three independent layers, any one of which blocks writes.
- **A Communication Agent that joins meetings** — this feels genuinely new. The agent doesn't just answer questions in a chat box; it participates in your Zoom call, presents data with voice, and responds to the room in real time.
- **Shipped a working product** — the platform is live at [knoda.itsamoghgr.com](https://knoda.itsamoghgr.com). Discovery, analysis, chart building, dashboards, and presentation mode all work end to end.

---

## What We Learned

- **Dialect translation beats prompt engineering** for SQL correctness. Telling the LLM "use DuckDB syntax" helps, but wrapping execution in `sqlglot.transpile()` catches what the prompt misses — and catches it every time, deterministically.
- **Audio on mobile is harder than it looks.** WebKit's autoplay policy is well-documented but the subtlety — that unlocking one `HTMLAudioElement` instance doesn't unlock others — cost us a full debugging session.
- **Agents need persistent memory to feel intelligent.** The difference between a one-shot LLM call and an agent that has read your schema, remembered what you've asked before, and built a model of your business is dramatic. That context layer is what makes Knoda feel like a colleague rather than a search engine.

---

## What's Next for Knoda.ai

**Near term**
- **Calendar integration** — agent auto-joins scheduled meetings and presents the right dashboard without being asked
- **Proactive anomaly detection** — agent monitors data in the background and surfaces unusual patterns before anyone asks
- **Scheduled reports** — agent generates and sends PDF/email reports on a defined cadence

**Longer term**
- **Slack / Teams integration** — query your data directly inside the tools your team already uses
- **Multi-database reasoning** — agent correlates signals across all connected data sources simultaneously
- **Natural language to dbt** — agent writes and documents data models from a plain English description
- **Collaborative dashboards** — shared workspaces with comments, version history, and multi-user access
- **Agentic data analysis** — a Jupyter-style notebook inside the platform where the agent performs exploratory data analysis autonomously *(in research phase)*

---

## Built With

`fastapi` · `langgraph` · `duckdb` · `sqlglot` · `postgresql` · `pgvector` · `openai` · `anthropic` · `next.js` · `react` · `tailwindcss` · `shadcn-ui` · `supabase` · `framer-motion` · `echarts` · `python` · `typescript`
