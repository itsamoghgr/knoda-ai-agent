# Knoda.ai

## The Idea

Every organization has data. Very few organizations can actually use it.

The bottleneck is always the same: business teams have questions, engineers own the databases, and analysts sit in the middle translating between them — writing SQL, building dashboards, presenting in meetings. This is slow, expensive, and doesn't scale.

Knoda.ai replaces that bottleneck with an autonomous AI data analyst.

You connect your database. The AI maps everything out — the schema, the relationships, the business meaning of every table and column. It builds a memory of your data and keeps it. From that point forward, anyone in the organization can ask it questions, get charts built, get dashboards presented, and get answers in plain English — without touching SQL, without waiting for an analyst, without raising a ticket.

The goal is not a smarter BI tool. The goal is an agent that works the way a data analyst works: it understands the data, holds context over time, and takes action autonomously.

---

## What We Are Building

An **agentic data intelligence platform** — a system where an AI agent autonomously understands your databases, builds organizational memory, and acts as the data analyst for your team.

The platform has three layers:

**1. Understanding**
The agent connects to your database and runs a full autonomous discovery. It reads the schema, samples data, infers relationships, classifies every table into a business entity (Orders, Users, Revenue, Events), identifies what each column measures or describes, and stores all of this as structured knowledge. It also creates vector embeddings of every table so it can find the right data by meaning, not just by name.

This knowledge — called AI Memory — is the foundation everything else is built on.

**2. Acting**
The agent does not just answer questions. It acts. It can:
- Answer business questions in plain English by writing and running SQL against your live database
- Build charts and dashboards autonomously when asked
- Present dashboards in live meetings — narrating the data, walking through each chart, and answering real-time verbal questions from the audience
- Help engineers write complex SQL in the SQL Lab

All of this happens through the same agentic loop: the agent thinks about what it knows, decides which tools to call, executes them, observes the results, and responds. No hardcoded workflows.

**3. Memory**
The agent gets smarter over time. Every discovery it runs, every chart it builds, every dashboard it creates — all of it is stored in AI Memory. The next time someone asks a question, the agent already knows the schema, the relationships, and what has already been built. It does not start from scratch on every request.

---

## Current State

The platform is functional as an MVP with the following capabilities:

**Discovery**
- Connect PostgreSQL, MySQL, DuckDB, or S3 Parquet sources (read-only)
- One-click autonomous discovery: the agent explores the database, classifies tables, infers relationships, and builds AI Memory
- Real-time visibility into the agent's thinking — tool calls and reasoning are streamed live

**AI Memory (stored in PostgreSQL + pgvector)**
- Catalog of every discovered table and column
- Semantic layer: business entities, dimensions, measures, relationships
- Vector embeddings for every table (OpenAI `text-embedding-3-small`, 1536 dimensions)
- All charts and dashboards ever built
- Business context: company description, revenue definition, fiscal year, etc.

**Analyst Agent**
- Ask any question in plain English — the agent finds the right tables, writes SQL, runs it, and answers
- Builds charts (bar, line, area, pie, donut, KPI, table) and full dashboards from a single instruction
- Semantic-first: reads from AI Memory before touching the live database
- Supports any LLM provider: Anthropic, OpenAI, Groq, Ollama

**Communication Agent**
- Open any dashboard in Presentation Mode
- The agent autonomously discovers what charts are on the dashboard, narrates each one with key insights, and presents to the audience
- Audience members can ask questions verbally — the agent answers in real time using live data
- Barge-in support: interrupt the agent mid-speech with Space bar or mic button
- Server-side session management with full meeting conversation memory
- Powered by browser Web Speech API (STT) and OpenAI TTS

**SQL Lab**
- Write and run raw SQL against any connected database
- "Ask AI" button to construct or explain queries

**LLM + Token Management**
- Store multiple LLM providers, one active at a time, switch anytime
- Full token usage tracking per interaction

---

## The Direction

We are building toward a platform where the AI agent is not a feature — it is the analyst.

Today it answers questions and builds dashboards when asked.

The direction is autonomy: the agent that proactively monitors your data, surfaces anomalies before you ask, schedules its own presentations, joins meetings independently, and maintains a continuously updated understanding of your business — without you having to prompt it.

**Near term**
- Calendar integration: schedule meetings, agent auto-joins and presents the right dashboard
- Proactive alerts: agent detects anomalies and surfaces them without being asked
- Report generation: scheduled PDF/email reports built and sent by the agent

**Longer term**
- Multi-database reasoning: agent correlates signals across all connected data sources
- Collaborative dashboards: multiple users, comments, version history
- Natural language to data model: agent writes dbt models and documentation
- Slack / Teams integration: query your data in the tools your team already uses

---

## Architecture Summary

```
Your Databases (read-only)
        │
        ▼
   Query Engine (DuckDB)
   Multi-source, read-only ATTACH
        │
        ▼
   AI Agent Layer (LangGraph ReAct)
   ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐
   │ Discovery Agent│  │ Analyst Agent  │  │ Communication Agent │
   │ Schema + Memory│  │ Q&A + Dashboards│  │ Presentations + Voice│
   └────────────────┘  └────────────────┘  └─────────────────────┘
        │
        ▼
   AI Memory (PostgreSQL + pgvector)
   Catalog · Semantic Layer · Embeddings · Charts · Dashboards · Business Context
        │
        ▼
   Frontend (Next.js)
   Chat · SQL Lab · Dashboards · Presentation Mode · Settings
```

**Stack:** FastAPI · LangGraph · DuckDB · PostgreSQL · pgvector · Next.js · shadcn/ui · ECharts · OpenAI TTS · Web Speech API
