"""LangGraph Supervisor v2 — Orchestrator + Communicator (ReAct agent).

The Supervisor is a full ReAct agent (Think → Tool → Observe loop) that:
1. Routes data questions to analyst_agent or discovery_agent
2. Answers simple schema questions directly (no sub-agent needed)
3. Handles live presentation mode (narration via TTS, meeting Q&A)
4. Formats output for the appropriate channel (chat, Slack, meeting)

## Why ReAct (not a single structured routing call)?
The Supervisor genuinely needs tools to do its job:
  - `get_semantic_catalog` to answer schema questions directly
  - `find_existing_dataset` to check memory before delegating to analyst
  - `get_dashboard_charts` for presentation mode
  - `speak_tts` for TTS narration (meetings)

A structured single-call supervisor can only output a routing label — it cannot
call tools. The ReAct pattern allows all of the above AND routing via conditional
graph edges. The system prompt is crafted so clear-intent requests (e.g. "show me
top 10 customers") complete in 1 tool call (find_existing_dataset) then delegate.

## Routing
The supervisor responds to the graph with a structured routing signal:
  - Sets __next__ = "analyst_agent" | "discovery_agent" | END (direct answer)

## Channel-aware formatting
Before returning to the user, the supervisor formats its response based on the
channel metadata passed in the request:
  - "chat"    → markdown with headers/tables
  - "slack"   → markdown without headers (Slack renders differently)
  - "meeting" → plain spoken English, no markdown
  - "email"   → structured prose with subject line

## Merged from communication.py
The live presentation / meeting presenter functionality previously in communication.py
is now a tool set available to the supervisor. The supervisor handles meeting sessions
directly instead of requiring a separate agent.
"""

from __future__ import annotations

import contextlib
import logging
from datetime import UTC
from typing import Any

from langchain_core.tools import tool
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.prebuilt import create_react_agent

from agents.core import (
    AgentToolsContext,
    tool_execute_sql,
    tool_get_dashboard_charts,
    tool_get_semantic_catalog,
    tool_list_databases,
)

logger = logging.getLogger(__name__)


SUPERVISOR_PROMPT = """\
You are the Supervisor for Knoda AI — an AI-native data intelligence platform.

## Temporal context
Current UTC time: {current_utc_time}
When interpreting relative times ("tonight", "tomorrow", "in 2 hours"), use the
UTC time above as your reference. Always pass times to scheduling tools as ISO 8601
with an explicit UTC offset (e.g. "2026-03-29T23:45:00+00:00"). Never pass an
ambiguous natural-language time without a timezone abbreviation to these tools.

## Your job
1. Route data questions to the correct specialist agent (analyst or discovery)
2. Answer simple schema/catalog questions DIRECTLY without delegating
3. Handle live presentation mode for business meetings
4. Format all output for the correct channel

## When to use each tool

### `find_existing_dataset`
Call this FIRST for any data question before delegating to the analyst.
If a similar query already exists, return it directly and set routing → END.
If not, delegate to analyst_agent.

### `get_semantic_catalog`
Call this for schema questions like "what tables do we have?", "what columns
are in orders?", "how is revenue defined?". Answer directly from the catalog
without delegating.

### `get_dashboard_charts`
Call this at the start of a presentation session or when asked about a dashboard.
Use the result to narrate the dashboard's content.

### `search_dashboards`
Call this when you need to resolve a dashboard name to an ID.
- Use BEFORE `schedule_meeting_presentation` when dashboard is referenced by name.
- Use BEFORE `get_dashboard_charts` when only a name is given.
- If no exact match, pick the closest result and confirm with the user.
- NEVER ask the user for a UUID — always call this tool first.

### `list_meetings`
Call this to retrieve all meeting presentations for this tenant.
Use it:
- BEFORE `reschedule_meeting`, to look up the meeting_id to update.
- When the user asks "what meetings do I have?", "show scheduled meetings", etc.

### `speak_tts`
Call this when the channel is "meeting" and you need to produce spoken audio.
Pass plain English only — no markdown.

### `schedule_meeting_presentation`
Call this when the user wants to schedule a NEW meeting.
Steps:
1. ALWAYS call `search_dashboards` first to resolve the dashboard name → UUID.
   The `dashboard_id` parameter MUST be a UUID (e.g. "a1b2c3d4-..."), never a name string.
   If you pass a name instead of a UUID the schedule will fail silently.
2. Convert the time to ISO 8601 UTC (e.g. "2026-03-29T23:45:00+00:00") before calling.
3. Call `schedule_meeting_presentation(meet_url, dashboard_id, scheduled_time_str)`.
4. Confirm with a natural sentence including the formatted time and dashboard name.

### `reschedule_meeting`
Call this when the user wants to CHANGE the time, URL, or dashboard of an EXISTING meeting.
Examples: "change meeting to 3pm", "move it to tomorrow", "reschedule to 4:30 PM".
Steps:
1. Call `list_meetings` to find all meetings. Pick the most recently created one
   with status "scheduled". If multiple are scheduled, ask the user which one.
2. Convert the new time to ISO 8601 UTC before calling.
3. Call `reschedule_meeting(meeting_id, new_scheduled_time_str)`.
4. Confirm the new time with a natural sentence.
NEVER call `schedule_meeting_presentation` for a reschedule — always use this tool.

### Chart and dashboard creation
For ANY request to create, build, or generate charts or dashboards — always route to analyst:
  ("create a dashboard", "build a revenue chart", "make a bar chart", "I want a dashboard",
   "add a chart to a dashboard", "show this as a chart", "create a KPI", "build a table chart")
  → Output ONLY: <route>analyst</route>
  Never answer these yourself. The analyst_agent has all creation tools:
  create_chart, create_dashboard, find_similar_dashboards, add_chart_to_dashboard.

### Chart and dashboard listing/inspection
For requests about existing charts or dashboards:
  ("what charts do we have?", "list dashboards", "what's on the sales dashboard?")
  → Output ONLY: <route>analyst</route>
  Never answer these yourself.

## Routing signal
After deciding, respond with one of these XML tags:
  <route>analyst</route>     → delegate to analyst_agent (say ONLY this tag, nothing else)
  <route>discovery</route>   → delegate to discovery_agent (say ONLY this tag, nothing else)
  (no tag)                   → you answered it yourself; just write your response normally

## Channel formatting rules
- chat    → markdown (use **bold**, headers, tables)
- slack   → bold text (`*bold*`) without headers
- meeting → plain spoken English ONLY, no markdown whatsoever
- email   → structured prose with subject line

## Absolute rules
- Never output SQL in responses — use execute_sql() then speak the result
- When routing to an agent, output ONLY the <route>xxx</route> tag — no extra text, no plan, no explanation
- When answering directly, just write your response without any prefix or tag
- If the request is ambiguous between catalog/data, default to <route>analyst</route>
"""


def build_supervisor(
    llm: Any,
    discovery_agent: Any,
    analyst_agent: Any,
    ctx: AgentToolsContext | None = None,
    current_utc_time: str = "",
) -> Any:
    """Build the v2 Supervisor as a ReAct agent within a LangGraph StateGraph.

    The supervisor runs its own tool loop, then the graph routes to the
    appropriate sub-agent based on the supervisor's routing signal.

    Args:
        llm:               shared LLM (single provider, from build_llm())
        discovery_agent:   compiled discovery sub-graph
        analyst_agent:     compiled analyst sub-graph
        ctx:               AgentToolsContext (optional; if None, supervisor
                           runs without memory/data tools — backward compat)
        current_utc_time:  ISO 8601 UTC string injected into the system prompt
                           so the agent has an accurate temporal reference.

    Returns:
        Compiled LangGraph StateGraph.
    """

    # ── Tool definitions (bound to ctx) ──────────────────────────────────────

    @tool
    async def get_semantic_catalog() -> str:
        """Load the pre-built semantic catalog.

        Returns descriptions of all tables, columns, measures, and relationships
        the AI knows about. Call this for schema questions like:
        - "What tables do we have?"
        - "What columns are in the orders table?"
        - "How is revenue defined?"
        This reads from pre-computed knowledge. Zero live DB calls.
        """
        if ctx is None:
            return "No semantic catalog available (no context provided)."
        return await tool_get_semantic_catalog(ctx)

    @tool
    async def find_existing_dataset(question: str) -> str:
        """Search long-term memory for a dataset that answers a similar question.

        question: the user's data question in natural language

        Call this BEFORE delegating to the analyst. If a similar query was
        answered before, the dataset already exists and can be reused instantly.
        Returns: JSON with dataset_id, description, similarity_score, or
        a "no match" message if no suitable dataset is found.
        """
        if ctx is None:
            return '{"match": false, "reason": "No memory context available"}'
        try:
            from agents.core import tool_find_existing_dataset

            return await tool_find_existing_dataset(ctx, question)
        except (ImportError, AttributeError):
            return '{"match": false, "reason": "tool_find_existing_dataset not yet available"}'

    @tool
    async def get_dashboard_charts(dashboard_id: str) -> str:
        """Get all charts currently placed on a specific dashboard.

        dashboard_id: the ID of the dashboard to inspect

        Call this at the start of a presentation to discover what charts
        the audience can see. Returns chart names, types, descriptions, and IDs.
        """
        if ctx is None:
            return "No context available for dashboard lookup."
        return await tool_get_dashboard_charts(ctx, dashboard_id)

    @tool
    async def list_databases() -> str:
        """List all connected databases with their aliases.

        Use when you need to know the alias prefix (e.g. src0) for SQL queries.
        """
        if ctx is None:
            return "No databases connected."
        return await tool_list_databases(ctx)

    @tool
    async def execute_sql(sql: str) -> str:
        """Execute a read-only SQL SELECT query to get live data.

        Always qualify table names: alias.schema.table (e.g. src0.public.orders)
        Only call this when actual data values are needed — not for schema questions.
        """
        if ctx is None:
            return '{"error": "No database context available"}'
        return await tool_execute_sql(ctx, sql)

    @tool
    async def speak_tts(text: str) -> str:
        """Generate spoken audio narration using OpenAI TTS.

        text: plain English text to speak (no markdown, no bullet points)

        Call this when channel="meeting" to produce audio. Returns a base64
        encoded audio payload that the frontend will play automatically.
        Only use for meeting channel — other channels receive text responses.
        """
        try:
            import base64

            from openai import AsyncOpenAI

            from config import settings

            client = AsyncOpenAI(
                api_key=settings.openai_api_key if hasattr(settings, "openai_api_key") else ""
            )
            voice = getattr(settings, "tts_voice", "alloy")
            tts_model = getattr(settings, "tts_model", "tts-1")

            response = await client.audio.speech.create(
                model=tts_model,
                voice=voice,
                input=text[:4096],  # OpenAI TTS max 4096 chars
            )
            audio_bytes = response.content
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
            return f'{{"audio_b64": "{audio_b64}", "format": "mp3"}}'
        except Exception as exc:
            logger.warning("TTS generation failed: %s", exc)
            return f'{{"error": "TTS failed: {exc}", "text": "{text[:200]}"}}'

    @tool
    async def schedule_meeting_presentation(
        meet_url: str,
        dashboard_id: str,
        scheduled_time_str: str,
    ) -> str:
        """Schedule the AI bot to join a Google Meet and present a dashboard.

        meet_url: full Google Meet URL (https://meet.google.com/xxx-xxxx-xxx)
        dashboard_id: UUID of the dashboard to present — MUST be a UUID string like
            "a1b2c3d4-e5f6-7890-abcd-ef1234567890". Never pass a dashboard name here.
            Call search_dashboards first to resolve any name to its UUID.
        scheduled_time_str: when to join — natural language ("4:30 PM today",
            "tomorrow at 3pm") or ISO 8601. Must be in the future.

        IMPORTANT: Always call search_dashboards before this tool to get the dashboard UUID.
        """
        if ctx is None:
            return "Cannot schedule: no context available."

        import re
        import urllib.parse
        import uuid

        import dateparser

        # Normalize URL: strip whitespace, trailing slash, query params, fragments
        _parsed_url = urllib.parse.urlparse(meet_url.strip())
        meet_url = urllib.parse.urlunparse(
            (_parsed_url.scheme, _parsed_url.netloc, _parsed_url.path.rstrip("/"), "", "", "")
        )

        # Validate Google Meet URL (case-insensitive, alphanumeric segments)
        if not re.match(
            r"https://meet\.google\.com/[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}",
            meet_url,
            re.IGNORECASE,
        ):
            return (
                f"'{meet_url}' does not look like a valid Google Meet URL. "
                "Expected format: https://meet.google.com/xxx-xxxx-xxx"
            )

        # Parse the scheduled time — default to UTC for ambiguous inputs
        parsed_time = dateparser.parse(
            scheduled_time_str,
            settings={  # type: ignore[arg-type]
                "PREFER_DATES_FROM": "future",
                "RETURN_AS_TIMEZONE_AWARE": True,
                "TIMEZONE": "UTC",
                "TO_TIMEZONE": "UTC",
            },
        )
        if parsed_time is None:
            return (
                f"Could not understand the time '{scheduled_time_str}'. "
                "Try something like '4:30 PM', 'tomorrow at 3pm', or '2026-04-01T16:30:00Z'."
            )

        from datetime import datetime

        if parsed_time <= datetime.now(tz=UTC):
            return "The scheduled time appears to be in the past. Please provide a future time."

        # Validate dashboard_id is a proper UUID (not a name string)
        try:
            uuid.UUID(dashboard_id)
        except (ValueError, AttributeError):
            return (
                f"'{dashboard_id}' is not a valid dashboard ID. "
                "Use search_dashboards to look up the dashboard by name and get its UUID first."
            )

        # Persist meeting record and schedule with APScheduler
        try:
            from meeting.scheduler import schedule_meeting_job
            from storage.database import AsyncSessionFactory
            from storage.repositories.meeting_repo import MeetingPresentationRepository

            async with AsyncSessionFactory() as db:
                repo = MeetingPresentationRepository(db, ctx.tenant_id)
                orm = await repo.create(
                    dashboard_id=dashboard_id,
                    meet_url=meet_url,
                    scheduled_at=parsed_time,
                )

            await schedule_meeting_job(
                meeting_id=orm.id,
                meet_url=meet_url,
                dashboard_id=dashboard_id,
                tenant_id=ctx.tenant_id,
                scheduled_at=parsed_time,
            )

            formatted_time = parsed_time.strftime("%-I:%M %p %Z on %B %-d")
            return (
                f"Done! I've scheduled a meeting presentation for {formatted_time}. "
                f"I will join {meet_url} and present the dashboard at that time. "
                "Make sure to admit me when I appear in the waiting room."
            )
        except Exception as exc:
            logger.error("Failed to schedule meeting: %s", exc, exc_info=True)
            return f"Failed to schedule the meeting: {exc}"

    @tool
    async def reschedule_meeting(
        meeting_id: str,
        new_scheduled_time_str: str,
        new_meet_url: str | None = None,
        new_dashboard_id: str | None = None,
    ) -> str:
        """Reschedule an existing meeting to a new time (and optionally new URL/dashboard).

        meeting_id: the UUID of the scheduled meeting to update
        new_scheduled_time_str: new time in natural language or ISO 8601
        new_meet_url: optional new Google Meet URL
        new_dashboard_id: optional new dashboard UUID

        Call this when user says "change time to X", "move the meeting to Y", "reschedule".
        Do NOT create a new meeting — update the existing one.
        """
        if ctx is None:
            return "Cannot reschedule: no context available."

        import dateparser

        parsed_time = dateparser.parse(
            new_scheduled_time_str,
            settings={  # type: ignore[arg-type]
                "PREFER_DATES_FROM": "future",
                "RETURN_AS_TIMEZONE_AWARE": True,
                "TIMEZONE": "UTC",
                "TO_TIMEZONE": "UTC",
            },
        )
        if parsed_time is None:
            return (
                f"Could not understand '{new_scheduled_time_str}'. "
                "Try: '4:30 PM', 'tomorrow at 3pm', or '2026-04-01T16:30:00Z'."
            )

        from datetime import datetime

        if parsed_time <= datetime.now(tz=UTC):
            return "The new time appears to be in the past. Please provide a future time."

        try:
            from meeting.scheduler import cancel_meeting_job, schedule_meeting_job
            from storage.database import AsyncSessionFactory
            from storage.repositories.meeting_repo import MeetingPresentationRepository

            async with AsyncSessionFactory() as db:
                repo = MeetingPresentationRepository(db, ctx.tenant_id)
                orm = await repo.update(
                    meeting_id,
                    scheduled_at=parsed_time,
                    meet_url=new_meet_url,
                    dashboard_id=new_dashboard_id,
                )
            if orm is None:
                return f"Meeting {meeting_id} not found or you don't have permission to update it."

            with contextlib.suppress(Exception):
                cancel_meeting_job(meeting_id)
            await schedule_meeting_job(
                meeting_id=meeting_id,
                meet_url=orm.meet_url,
                dashboard_id=orm.dashboard_id,
                tenant_id=ctx.tenant_id,
                scheduled_at=parsed_time,
            )

            formatted_time = parsed_time.strftime("%-I:%M %p %Z on %B %-d")
            return f"Done! The meeting has been rescheduled to {formatted_time}."
        except Exception as exc:
            logger.error("Failed to reschedule meeting: %s", exc, exc_info=True)
            return f"Failed to reschedule: {exc}"

    @tool
    async def search_dashboards(query: str) -> str:
        """Search dashboards by name to resolve a name to an ID.

        query: dashboard name or partial name (e.g. "CEO Revenue Dashboard 2025")

        Always call this before schedule_meeting_presentation or get_dashboard_charts
        when the user references a dashboard by name. Never ask the user for a UUID.
        Returns matching dashboards with id, name, description.
        """
        if ctx is None:
            return '{"dashboards": [], "reason": "No context available"}'
        import json

        async with ctx.session_factory() as db:
            from storage.repositories.charts_repo import DashboardRepository

            repo = DashboardRepository(db, ctx.tenant_id)
            matches = await repo.find_similar(query, threshold=0.15)
            if not matches:
                # Fallback: list all dashboards so agent can pick the closest
                all_dashboards = await repo.list()
                if not all_dashboards:
                    return json.dumps(
                        {"dashboards": [], "reason": "No dashboards found for this account"}
                    )
                matches = [
                    {
                        "id": str(d.id),
                        "name": d.name,
                        "description": d.description or "",
                        "similarity_score": 0.0,
                    }
                    for d in all_dashboards[:10]
                ]
        return json.dumps({"dashboards": matches})

    @tool
    async def list_meetings() -> str:
        """List all meeting presentations scheduled for this tenant.

        Returns a JSON array of meetings, each with:
          id, dashboard_id, meet_url, scheduled_at (ISO 8601), status, created_at

        Call this before `reschedule_meeting` to find the meeting_id to update,
        or when the user asks what meetings are scheduled / their meeting history.
        """
        if ctx is None:
            return '{"meetings": [], "reason": "No context available"}'
        import json

        try:
            from storage.repositories.meeting_repo import MeetingPresentationRepository

            async with ctx.session_factory() as db:
                repo = MeetingPresentationRepository(db, ctx.tenant_id)
                meetings = await repo.list()

            return json.dumps(
                {
                    "meetings": [
                        {
                            "id": m.id,
                            "dashboard_id": m.dashboard_id,
                            "meet_url": m.meet_url,
                            "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
                            "status": m.status,
                            "created_at": m.created_at.isoformat() if m.created_at else None,
                        }
                        for m in meetings
                    ]
                }
            )
        except Exception as exc:
            logger.error("Failed to list meetings: %s", exc, exc_info=True)
            return json.dumps({"meetings": [], "error": str(exc)})

    # ── Supervisor tools list ─────────────────────────────────────────────────
    supervisor_tools = [
        find_existing_dataset,
        get_semantic_catalog,
        get_dashboard_charts,
        search_dashboards,
        list_meetings,
        list_databases,
        execute_sql,
        speak_tts,
        schedule_meeting_presentation,
        reschedule_meeting,
    ]

    # ── Build supervisor as ReAct agent ───────────────────────────────────────
    _prompt = SUPERVISOR_PROMPT.format(
        current_utc_time=current_utc_time or "unknown (not injected)",
    )
    supervisor_react = create_react_agent(
        llm,
        tools=supervisor_tools,
        prompt=_prompt,
    )

    # ── Routing logic — reads supervisor output ───────────────────────────────

    def route_after_supervisor(state: MessagesState) -> str:
        """Read the supervisor's routing signal from ANY AI message.

        Scans all messages for <route>xxx</route> tags first (v2 format),
        then checks for legacy ROUTE: prefix signals (backward compat).
        Falls through to END when no routing signal exists — meaning the
        supervisor answered the question itself.
        """
        import re

        messages = state.get("messages", [])

        # Pass 1: scan ALL messages (newest-first) for routing signals
        for m in reversed(messages):
            content = ""
            if hasattr(m, "content") and m.content:
                content = m.content if isinstance(m.content, str) else str(m.content)

            # v2: XML-style <route>analyst</route>
            route_match = re.search(r"<route>\s*(analyst|discovery)\s*</route>", content)
            if route_match:
                target = route_match.group(1)
                logger.info("Supervisor routing: found <route>%s</route> signal", target)
                return f"{target}_agent"

            # v1 compat: ROUTE:analyst / ROUTE:discovery
            if "ROUTE:analyst" in content:
                logger.info("Supervisor routing: found ROUTE:analyst signal (legacy)")
                return "analyst_agent"
            if "ROUTE:discovery" in content:
                logger.info("Supervisor routing: found ROUTE:discovery signal (legacy)")
                return "discovery_agent"

        # Pass 2: no routing signal found — check for a direct answer
        for m in reversed(messages):
            if (hasattr(m, "content") and m.content) and (
                not hasattr(m, "tool_calls") or not m.tool_calls
            ):
                content = m.content if isinstance(m.content, str) else str(m.content)
                if content.strip():
                    logger.info("Supervisor routing: direct answer (no routing signal) → END")
                    return END
                break

        # Default: route to analyst (safest fallback for data questions)
        logger.info("Supervisor routing: no explicit signal found, defaulting to analyst_agent")
        return "analyst_agent"

    # ── Build LangGraph StateGraph ────────────────────────────────────────────
    graph = StateGraph(MessagesState)

    graph.add_node("supervisor", supervisor_react)
    graph.add_node("discovery_agent", discovery_agent)
    graph.add_node("analyst_agent", analyst_agent)

    graph.set_entry_point("supervisor")

    graph.add_conditional_edges(
        "supervisor",
        route_after_supervisor,
        {
            "analyst_agent": "analyst_agent",
            "discovery_agent": "discovery_agent",
            END: END,
        },
    )

    graph.add_edge("discovery_agent", END)
    graph.add_edge("analyst_agent", END)

    return graph.compile()
