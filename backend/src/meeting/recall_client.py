"""Async HTTP client for the Recall.ai Meeting Bot API.

Docs: https://docs.recall.ai/reference
"""

from __future__ import annotations

import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

_RECALL_BASE = "https://us-west-2.recall.ai/api/v1"


class BotCompletedError(Exception):
    """Raised when Recall.ai rejects a command because the bot has already left the meeting."""


class RecallClient:
    """Thin async wrapper around the Recall.ai REST API."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=_RECALL_BASE,
            headers={
                "Authorization": f"Token {settings.recall_api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def __aenter__(self) -> "RecallClient":
        return self

    async def __aexit__(self, *_) -> None:
        await self._client.aclose()

    async def create_bot(
        self,
        meeting_url: str,
        webhook_url: str,
    ) -> str:
        """Create a Recall.ai bot that joins `meeting_url`.

        Returns the bot ID.
        """
        # Build recording config with webhook for real-time events.
        # Transcription requires a provider (Gladia/Deepgram) configured in the
        # Recall.ai dashboard. If not configured, omit transcript events — the bot
        # still joins, shares screen, and plays audio; Q&A via transcript is disabled
        # until a transcription provider is set up.
        realtime_endpoints = []
        if webhook_url:
            realtime_endpoints.append({
                "type": "webhook",
                "url": webhook_url,
                "events": ["participant_events.join", "participant_events.leave"],
            })

        # A 1-second silent MP3 (base64) — required to enable the output_audio endpoint.
        # Without automatic_audio_output configured at creation time, output_audio calls fail.
        _SILENT_MP3_B64 = (
            "/+MYxAAEaAIEeUAhAgAgIAH/wBwIBBBBIGAQCwGCIIAQDgIBgH/iAgHAYDAIDAYAgMBgIBAIDDAIBAYGBAID"
            "BgEAgMBgQCAQGAwGAQGBgIBAIDAYEAgMBgICAgEAgMBgICAQGAwGA4BAICAQGAQGBAID"
        )
        payload = {
            "meeting_url": meeting_url,
            "bot_name": settings.meet_bot_name,
            "recording_config": {
                "realtime_endpoints": realtime_endpoints,
            },
            "automatic_audio_output": {
                "in_call_recording": {
                    "data": {
                        "kind": "mp3",
                        "b64_data": _SILENT_MP3_B64,
                    }
                }
            },
        }
        resp = await self._client.post("/bot", json=payload)
        resp.raise_for_status()
        bot_id: str = resp.json()["id"]
        logger.info("Recall.ai bot created: %s → %s", bot_id, meeting_url)
        return bot_id

    async def output_screenshare_frame(self, bot_id: str, jpeg_b64: str) -> None:
        """Push a single JPEG frame as the bot's screenshare."""
        resp = await self._client.post(
            f"/bot/{bot_id}/output_screenshare",
            json={"kind": "jpeg", "b64_data": jpeg_b64},
        )
        if resp.status_code not in (200, 201, 204):
            if resp.status_code == 400 and "cannot_command_completed_bot" in resp.text:
                raise BotCompletedError(f"Bot {bot_id} has already completed")
            logger.warning(
                "output_screenshare failed for bot %s: %s %s",
                bot_id,
                resp.status_code,
                resp.text[:200],
            )

    async def output_audio(self, bot_id: str, mp3_bytes: bytes) -> None:
        """Play MP3 audio through the bot's microphone in the meeting.

        Requires the bot to have been created with automatic_audio_output configured.
        Uses the correct output_audio endpoint (not output_media).
        Raises BotCompletedError if the bot has already left the meeting.
        """
        import base64

        b64 = base64.b64encode(mp3_bytes).decode()
        resp = await self._client.post(
            f"/bot/{bot_id}/output_audio",
            json={"kind": "mp3", "b64_data": b64},
        )
        if resp.status_code not in (200, 201, 204):
            if resp.status_code == 400 and "cannot_command_completed_bot" in resp.text:
                raise BotCompletedError(f"Bot {bot_id} has already completed")
            logger.warning(
                "output_audio failed for bot %s: %s %s",
                bot_id,
                resp.status_code,
                resp.text[:200],
            )

    async def stop_bot(self, bot_id: str) -> None:
        """Remove the bot from the meeting."""
        resp = await self._client.delete(f"/bot/{bot_id}")
        if resp.status_code not in (200, 204):
            logger.warning(
                "stop_bot failed for bot %s: %s %s",
                bot_id,
                resp.status_code,
                resp.text[:200],
            )
        else:
            logger.info("Recall.ai bot %s stopped", bot_id)

    async def get_bot_status(self, bot_id: str) -> str:
        """Return the bot's current status string (e.g. 'in_call_not_recording')."""
        resp = await self._client.get(f"/bot/{bot_id}")
        resp.raise_for_status()
        return resp.json().get("status_changes", [{}])[-1].get("code", "unknown")
