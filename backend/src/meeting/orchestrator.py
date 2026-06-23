"""Meeting orchestrator — coordinates the full meeting bot lifecycle.

Flow:
  1. Create Recall.ai bot → bot joins the Google Meet
  2. Start screenshare loop (Playwright → JPEG frames → Recall.ai)
  3. Create a presentation session (reuses present.py internals)
  4. Trigger opening narration (empty ask → Communication Agent → TTS → Recall audio)
  5. Wait for inactivity or stop signal
  6. Clean up: stop bot, update DB status

Q&A from attendees is driven by the webhook handler in meetings.py router, which calls
`answer_and_play()` directly — the orchestrator just keeps the screenshare alive.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime

from config import settings
from meeting.recall_client import RecallClient
from meeting.screenshare import run_screenshare_loop
from storage.database import AsyncSessionFactory
from storage.repositories.meeting_repo import MeetingPresentationRepository

logger = logging.getLogger(__name__)

# Inactivity timeout — bot leaves the meeting after this many seconds of silence
_INACTIVITY_TIMEOUT = 1800  # 30 minutes

# Registry so the webhook handler can look up active sessions by bot_id
_active_sessions: dict[str, ActiveSession] = {}


class ActiveSession:
    """Runtime state for one active meeting bot."""

    def __init__(
        self,
        meeting_id: str,
        bot_id: str,
        present_session_id: str,
        tenant_id: str,
        recall: RecallClient,
        stop_event: asyncio.Event,
    ) -> None:
        self.meeting_id = meeting_id
        self.bot_id = bot_id
        self.present_session_id = present_session_id
        self.tenant_id = tenant_id
        self.recall = recall
        self.stop_event = stop_event
        self.last_activity = datetime.utcnow()
        # Serialize Q&A so two simultaneous questions don't overlap audio
        self._qa_lock = asyncio.Lock()


def get_active_session(bot_id: str) -> ActiveSession | None:
    return _active_sessions.get(bot_id)


async def run_meeting(
    meeting_id: str,
    meet_url: str,
    dashboard_id: str,
    tenant_id: str,
) -> None:
    """Entry point called by APScheduler at the scheduled time."""
    logger.info("Meeting %s starting — joining %s", meeting_id, meet_url)

    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, tenant_id)
        await repo.update_status(meeting_id, "running")

    async with RecallClient() as recall:
        try:
            await _run_meeting_inner(
                meeting_id=meeting_id,
                meet_url=meet_url,
                dashboard_id=dashboard_id,
                tenant_id=tenant_id,
                recall=recall,
            )
            async with AsyncSessionFactory() as db:
                repo = MeetingPresentationRepository(db, tenant_id)
                await repo.update_status(meeting_id, "completed")
        except Exception as exc:
            logger.error("Meeting %s failed: %s", meeting_id, exc, exc_info=True)
            async with AsyncSessionFactory() as db:
                repo = MeetingPresentationRepository(db, tenant_id)
                await repo.update_status(meeting_id, "failed", error_message=str(exc))


async def _run_meeting_inner(
    meeting_id: str,
    meet_url: str,
    dashboard_id: str,
    tenant_id: str,
    recall: RecallClient,
) -> None:
    # Webhook URL must be publicly reachable — use FRONTEND_BASE_URL's origin
    # but point at the API backend. In local dev, use a tunnel (e.g. ngrok).
    webhook_url = f"{settings.frontend_base_url.rstrip('/')}/api/v1/meetings/webhook/transcript"
    # Note: Recall.ai calls the webhook on the backend, not the frontend.
    # The line above is intentionally using FRONTEND_BASE_URL as a convenience
    # for environments where frontend and API share the same public hostname.
    # Override with an explicit env var if they differ.
    api_webhook_url = getattr(settings, "api_public_url", None)
    if api_webhook_url:
        webhook_url = f"{api_webhook_url.rstrip('/')}/api/v1/meetings/webhook/transcript"

    # 1. Create the Recall.ai bot
    bot_id = await recall.create_bot(meet_url, webhook_url=webhook_url)

    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, tenant_id)
        await repo.update_status(meeting_id, "running", recall_bot_id=bot_id)

    # 2. Create a presentation session (bypasses HTTP auth — internal call)
    present_session_id = await _create_presentation_session(dashboard_id, tenant_id)

    async with AsyncSessionFactory() as db:
        repo = MeetingPresentationRepository(db, tenant_id)
        await repo.update_status(meeting_id, "running", present_session_id=present_session_id)

    stop_event = asyncio.Event()
    session = ActiveSession(
        meeting_id=meeting_id,
        bot_id=bot_id,
        present_session_id=present_session_id,
        tenant_id=tenant_id,
        recall=recall,
        stop_event=stop_event,
    )
    _active_sessions[bot_id] = session

    try:
        dashboard_url = f"{settings.frontend_base_url.rstrip('/')}/dashboards/{dashboard_id}?bot=1"

        # Wait for the bot to be in_call before starting screenshare/narration
        await _wait_for_bot_in_call(bot_id, recall)

        # dashboard_ready is set by the screenshare loop once charts are visible,
        # so narration doesn't start until the bot is actually showing something.
        dashboard_ready = asyncio.Event()

        async with asyncio.TaskGroup() as tg:
            tg.create_task(
                run_screenshare_loop(
                    dashboard_url,
                    bot_id,
                    recall,
                    stop_event,
                    dashboard_ready,
                    present_session_id=present_session_id,
                ),
                name="screenshare",
            )
            tg.create_task(
                _opening_narration(session, dashboard_ready),
                name="narration",
            )
            tg.create_task(
                _inactivity_watchdog(session, stop_event),
                name="watchdog",
            )
    finally:
        _active_sessions.pop(bot_id, None)
        await recall.stop_bot(bot_id)
        logger.info("Meeting %s ended — bot %s stopped", meeting_id, bot_id)


async def _create_presentation_session(dashboard_id: str, tenant_id: str) -> str:
    """Create a Redis-backed presentation session without going through HTTP."""
    import json
    from dataclasses import asdict

    from api.routers.present import PresentationSession, _skey
    from storage.redis_client import get_redis

    session_id = str(uuid.uuid4())
    session = PresentationSession(
        session_id=session_id,
        dashboard_id=dashboard_id,
        tenant_id=tenant_id,
    )
    payload = json.dumps(asdict(session))
    SESSION_TTL = 7200  # 2 hours for meeting sessions
    await get_redis().set(_skey(session_id, tenant_id), payload, ex=SESSION_TTL)
    logger.info(
        "Created bot presentation session %s for dashboard %s",
        session_id[:8],
        dashboard_id[:8],
    )
    return session_id


async def _wait_for_bot_in_call(bot_id: str, recall: RecallClient, timeout: int = 120) -> None:
    """Poll bot status until it's in_call (joined the meeting) or timeout."""
    in_call_statuses = {"in_call_not_recording", "in_call_recording"}
    for _ in range(timeout // 5):
        try:
            status = await recall.get_bot_status(bot_id)
            logger.info("Bot %s status: %s", bot_id, status)
            if status in in_call_statuses:
                return
        except Exception as exc:
            logger.warning("Could not get bot status: %s", exc)
        await asyncio.sleep(5)
    logger.warning("Bot %s did not join call within %ds — proceeding anyway", bot_id, timeout)


async def _opening_narration(session: ActiveSession, dashboard_ready: asyncio.Event) -> None:
    """Wait for dashboard to render, then trigger the Communication Agent narration."""
    logger.info("Narration waiting for dashboard render for bot %s", session.bot_id)
    await dashboard_ready.wait()
    # Small buffer so first screenshare frames arrive before audio starts
    await asyncio.sleep(2)
    logger.info("Starting opening narration for bot %s", session.bot_id)
    try:
        await answer_and_play(session, message="")
    except Exception as exc:
        logger.error("Opening narration failed: %s", exc, exc_info=True)


def _mp3_duration(mp3_bytes: bytes) -> float:
    """Return the duration of an MP3 in seconds by parsing frame headers.

    Walks the first few MPEG frames to read the bitrate, then estimates total
    duration from file size and bitrate. Falls back to a conservative size-based
    estimate (24kbps) if parsing fails. Adding 0.5s of padding ensures the
    next chunk is not sent before the current one has fully finished playing.
    """
    try:
        # Find the first valid MPEG sync word (0xFF 0xEx or 0xFF 0xFx)
        i = 0
        while i < len(mp3_bytes) - 4:
            if mp3_bytes[i] == 0xFF and (mp3_bytes[i + 1] & 0xE0) == 0xE0:
                # Parse MPEG frame header (4 bytes)
                header = int.from_bytes(mp3_bytes[i : i + 4], "big")
                # Bitrate index (bits 15-12)
                bitrate_index = (header >> 12) & 0xF
                # MPEG layer (bits 17-16): 01=Layer3, 10=Layer2, 11=Layer1
                layer = (header >> 17) & 0x3
                # MPEG version (bits 20-19): 11=MPEG1, 10=MPEG2, 00=MPEG2.5
                version = (header >> 19) & 0x3

                # Bitrate table for MPEG1 Layer3 (most common for TTS output), kbps
                _BITRATES_MPEG1_L3 = [
                    0,
                    32,
                    40,
                    48,
                    56,
                    64,
                    80,
                    96,
                    112,
                    128,
                    160,
                    192,
                    224,
                    256,
                    320,
                    0,
                ]
                if version == 3 and layer == 1 and 0 < bitrate_index < 15:
                    kbps = _BITRATES_MPEG1_L3[bitrate_index]
                    if kbps > 0:
                        duration = (len(mp3_bytes) * 8) / (kbps * 1000)
                        return duration + 0.5  # 0.5s padding
            i += 1
    except Exception:
        pass

    # Fallback: assume 24kbps (OpenAI tts-1 minimum)
    return (len(mp3_bytes) * 8) / (24 * 1000) + 0.5


def _split_into_chunks(text: str, max_chars: int = 500) -> list[str]:
    """Split text into chunks of at most max_chars at sentence boundaries.

    Splits preferably after sentence-ending punctuation (. ! ?) followed by
    whitespace. Falls back to the nearest whitespace before the limit if a
    single sentence exceeds max_chars.
    """
    import re

    chunks: list[str] = []
    remaining = text.strip()
    sentence_end = re.compile(r"(?<=[.!?])\s+")

    while len(remaining) > max_chars:
        # Find the last sentence boundary within max_chars
        candidate = remaining[:max_chars]
        matches = list(sentence_end.finditer(candidate))
        if matches:
            split_at = matches[-1].start() + 1  # include the punctuation
            chunk = remaining[:split_at].strip()
            remaining = remaining[split_at:].strip()
        else:
            # No sentence boundary — split at nearest whitespace before limit
            space_idx = candidate.rfind(" ")
            if space_idx == -1:
                # No whitespace at all — force split at max_chars
                chunk = remaining[:max_chars]
                remaining = remaining[max_chars:].strip()
            else:
                chunk = remaining[:space_idx].strip()
                remaining = remaining[space_idx:].strip()
        if chunk:
            chunks.append(chunk)

    if remaining:
        chunks.append(remaining)

    return chunks


async def answer_and_play(session: ActiveSession, message: str) -> None:
    """Call the Communication Agent, collect the text response, TTS it, play via Recall.ai.

    Splits the response into chunks of ~500 chars at sentence boundaries and
    sends each chunk as a separate output_audio call to stay within Recall.ai's
    1,835,008-character base64 payload limit.
    Called from:
      - _opening_narration (empty message = narrate dashboard)
      - webhook handler (non-empty message = answer attendee question)
    """
    async with session._qa_lock:
        session.last_activity = datetime.utcnow()

        full_text = ""
        async for sentence in _stream_agent_sentences(session, message):
            full_text += sentence + " "

        full_text = full_text.strip()
        if not full_text:
            return

        from meeting.recall_client import BotCompletedError

        chunks = _split_into_chunks(full_text)
        for chunk in chunks:
            if session.stop_event.is_set():
                break
            try:
                mp3 = await _tts(chunk, session.tenant_id)
                await session.recall.output_audio(session.bot_id, mp3)
                # Wait for this chunk to finish playing before sending the next one.
                # Recall.ai queues and plays audio immediately — without this delay all
                # chunks would arrive simultaneously and play on top of each other.
                # Use asyncio.shield so a TaskGroup cancellation during teardown doesn't
                # abort mid-sleep and skip the remaining chunks.
                duration = _mp3_duration(mp3)
                try:
                    await asyncio.shield(asyncio.sleep(duration))
                except asyncio.CancelledError:
                    # Task was cancelled (e.g. meeting ended) — stop cleanly
                    break
            except BotCompletedError:
                logger.info("Bot %s has completed — stopping audio playback", session.bot_id)
                break
            except Exception as exc:
                logger.warning("TTS/audio play failed for bot %s: %s", session.bot_id, exc)
                break

        logger.info(
            "Answered (%d chars, %d chunk(s)) for bot %s",
            len(full_text),
            len(chunks),
            session.bot_id,
        )


async def _stream_agent_sentences(session: ActiveSession, message: str):
    """Call the Communication Agent SSE stream and yield complete sentences."""

    from langchain_core.messages import AIMessage, HumanMessage

    from agents.communication import build_communication_agent
    from agents.core import AgentToolsContext, build_llm
    from api.routers.present import (
        MAX_HISTORY_EXCHANGES,
        _load_session,
        _save_session,
    )
    from models.connection import SourceConfig
    from query_engine.engine import QueryEngine
    from storage import source_config_cache
    from storage.repositories import JobRepository
    from storage.repositories.settings_repo import SettingsRepository

    # Load session from Redis
    present_session = await _load_session(session.present_session_id, session.tenant_id)
    if not present_session:
        logger.error("Presentation session not found for bot %s", session.bot_id)
        return

    # Load LLM config
    async with AsyncSessionFactory() as db:
        repo = SettingsRepository(db, session.tenant_id)
        provider, api_key, model = await repo.get_llm_config()

    if not provider or not model:
        logger.error("LLM not configured for tenant %s", session.tenant_id)
        return

    llm = build_llm(provider=provider, api_key=api_key or "", model=model)
    dashboard_id = present_session.dashboard_id

    with QueryEngine() as engine:
        all_cached = source_config_cache.all_configs()
        prefix = f"{session.tenant_id}:"
        job_configs: dict[str, SourceConfig] = {
            k[len(prefix) :]: v for k, v in all_cached.items() if k.startswith(prefix)
        }
        if not job_configs:
            async with AsyncSessionFactory() as jr_session:
                raw_configs = await JobRepository(
                    jr_session, session.tenant_id
                ).list_all_source_configs()
            for jid, raw in raw_configs.items():
                try:
                    cfg = SourceConfig(**raw)
                    source_config_cache.store(jid, cfg, tenant_id=session.tenant_id)
                    job_configs[jid] = cfg
                except Exception as exc:
                    logger.warning("Could not load SourceConfig for job %s: %s", jid, exc)

        alias_map: dict[str, str] = {}
        for jid, cfg in job_configs.items():
            try:
                alias = engine.attach(cfg)
                alias_map[jid] = alias
            except Exception as exc:
                logger.warning("Could not attach DB for job %s: %s", jid[:8], exc)

        ctx = AgentToolsContext(
            job_id=next(iter(job_configs), ""),
            engine=engine,
            session_factory=AsyncSessionFactory,
            tenant_id=session.tenant_id,
            alias_map=alias_map,
        )

        agent = build_communication_agent(llm, ctx, dashboard_id=dashboard_id)

        history_snapshot = list(present_session.history)
        lc_messages = []
        for h in history_snapshot:
            if h["role"] == "user" and h.get("content"):
                lc_messages.append(HumanMessage(content=h["content"]))
            elif h["role"] == "assistant" and h.get("content"):
                lc_messages.append(AIMessage(content=h["content"]))

        effective_message = (
            message.strip() or "Please begin your presentation of this dashboard now."
        )
        lc_messages.append(HumanMessage(content=effective_message))

        sentence_buf = ""
        full_response = ""

        async for ev in agent.astream_events(
            {"messages": lc_messages},
            version="v2",
            config={"recursion_limit": 100},
        ):
            if ev["event"] != "on_chat_model_stream":
                continue
            chunk = ev["data"].get("chunk")
            if chunk is None:
                continue
            content = chunk.content if hasattr(chunk, "content") else ""
            if isinstance(content, list):
                content = "".join(
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            if not isinstance(content, str) or not content:
                continue

            sentence_buf += content
            full_response += content

            # Yield on sentence boundaries for low-latency TTS
            while True:
                for delimiter in (".", "!", "?", "\n"):
                    idx = sentence_buf.find(delimiter)
                    if idx != -1:
                        sentence = sentence_buf[: idx + 1].strip()
                        sentence_buf = sentence_buf[idx + 1 :]
                        if sentence:
                            yield sentence
                        break
                else:
                    break

        # Yield any remaining text
        if sentence_buf.strip():
            yield sentence_buf.strip()

        # Persist updated history
        if full_response.strip():
            updated = [
                *history_snapshot,
                {"role": "user", "content": effective_message},
                {"role": "assistant", "content": full_response.strip()},
            ]
            max_messages = MAX_HISTORY_EXCHANGES * 2
            present_session.history = (
                updated[-max_messages:] if len(updated) > max_messages else updated
            )
            await _save_session(present_session)


async def _tts(text: str, tenant_id: str) -> bytes:
    """Convert text to MP3 bytes using OpenAI TTS.

    Key lookup order:
    1. Embedding API key (dedicated OpenAI key for embeddings/TTS)
    2. OpenAI LLM key (if active provider is openai)
    Raises ValueError with a clear message if no OpenAI key is available.
    """
    from openai import AsyncOpenAI

    from storage.repositories.settings_repo import SettingsRepository

    async with AsyncSessionFactory() as db:
        repo = SettingsRepository(db, tenant_id)
        api_key = await repo.get_embedding_api_key()
        if not api_key:
            # Fallback: use OpenAI LLM key if that's the active provider
            provider, llm_key, _ = await repo.get_llm_config()
            if provider == "openai" and llm_key:
                api_key = llm_key

    if not api_key:
        raise ValueError(
            "No OpenAI API key found for TTS. "
            "Configure an OpenAI key in Settings (either as LLM provider or embedding key)."
        )

    client = AsyncOpenAI(api_key=api_key)
    response = await client.audio.speech.create(
        model=settings.tts_model,
        voice=settings.tts_voice,  # type: ignore[arg-type]
        input=text,
    )
    return response.content


async def _inactivity_watchdog(session: ActiveSession, stop_event: asyncio.Event) -> None:
    """Set stop_event after _INACTIVITY_TIMEOUT seconds of no Q&A activity."""
    while not stop_event.is_set():
        await asyncio.sleep(60)
        elapsed = (datetime.utcnow() - session.last_activity).total_seconds()
        if elapsed >= _INACTIVITY_TIMEOUT:
            logger.info(
                "Bot %s inactive for %ds — ending meeting",
                session.bot_id,
                elapsed,
            )
            stop_event.set()
