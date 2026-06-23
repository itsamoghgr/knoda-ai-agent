"""Redis-backed chart snapshot store with circuit breaker.

Chart row data (the actual query results) lives ONLY in Redis.
PostgreSQL stores chart definitions and metadata — never the row data.

Key schema:
    snap:{chart_id}  →  JSON {columns, rows, row_count, cached_at}  TTL: 24h

On cache miss the API returns snapshot=None and the frontend shows
"No cached data — click Refresh".  The source DB is NEVER touched silently.

Circuit Breaker:
    After the first Redis timeout, all Redis operations are skipped for
    _CB_COOLDOWN seconds. This prevents 2-second timeout × N charts from
    blocking the API when Redis is unreachable (e.g., local dev can't
    reach DigitalOcean Redis).
"""

from __future__ import annotations

import contextlib
import json
import logging
import time
from datetime import UTC, datetime

from storage.redis_client import get_redis

logger = logging.getLogger(__name__)

SNAPSHOT_TTL = 86_400  # 24 hours
_PREFIX = "snap:"

# ── Circuit breaker state ─────────────────────────────────────────────────────
_CB_COOLDOWN = 60  # seconds to skip Redis after a failure
_cb_tripped_at: float = 0  # monotonic timestamp of last failure


def _cb_is_open() -> bool:
    """Return True if Redis is known to be down (skip all ops)."""
    return _cb_tripped_at > 0 and (time.monotonic() - _cb_tripped_at) < _CB_COOLDOWN


def _cb_trip() -> None:
    """Mark Redis as down — all ops will be skipped for _CB_COOLDOWN seconds."""
    global _cb_tripped_at
    if _cb_tripped_at == 0:
        logger.warning(
            "[snapshot_cache] Circuit breaker OPEN — skipping Redis for %ds", _CB_COOLDOWN
        )
    _cb_tripped_at = time.monotonic()


def _cb_reset() -> None:
    """Mark Redis as healthy again."""
    global _cb_tripped_at
    if _cb_tripped_at > 0:
        logger.info("[snapshot_cache] Circuit breaker CLOSED — Redis is reachable")
    _cb_tripped_at = 0


# ── Public API ────────────────────────────────────────────────────────────────


def _key(chart_id: str) -> str:
    return f"{_PREFIX}{chart_id}"


async def get(chart_id: str) -> dict | None:
    """Return cached snapshot for a single chart, or None on miss/error."""
    if _cb_is_open():
        return None
    try:
        raw = await get_redis().get(_key(chart_id))
        _cb_reset()
        return json.loads(raw) if raw else None
    except Exception as exc:
        _cb_trip()
        logger.warning("[snapshot_cache] get(%s) failed: %s", chart_id, exc)
        return None


async def get_many(chart_ids: list[str]) -> dict[str, dict]:
    """Return snapshots for multiple charts in a single Redis MGET round-trip.

    Returns a dict mapping chart_id → snapshot dict (only hits included).
    """
    if not chart_ids or _cb_is_open():
        return {}
    try:
        keys = [_key(cid) for cid in chart_ids]
        values = await get_redis().mget(*keys)
        _cb_reset()
        result: dict[str, dict] = {}
        for chart_id, raw in zip(chart_ids, values, strict=False):
            if raw:
                with contextlib.suppress(json.JSONDecodeError):
                    result[chart_id] = json.loads(raw)
        return result
    except Exception as exc:
        _cb_trip()
        logger.warning("[snapshot_cache] get_many failed: %s", exc)
        return {}


async def set(  # noqa: A001 — shadowing builtin intentionally for clarity
    chart_id: str,
    columns: list[str],
    rows: list[dict],
    cached_at: str | None = None,
) -> None:
    """Write (or overwrite) a snapshot into Redis with a 24-hour TTL."""
    if _cb_is_open():
        return
    payload = json.dumps(
        {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "cached_at": cached_at or datetime.now(UTC).isoformat(),
        },
        default=str,
    )
    try:
        await get_redis().set(_key(chart_id), payload, ex=SNAPSHOT_TTL)
        _cb_reset()
        logger.debug("[snapshot_cache] set(%s) rows=%d", chart_id, len(rows))
    except Exception as exc:
        _cb_trip()
        logger.warning("[snapshot_cache] set(%s) failed: %s", chart_id, exc)


async def delete(chart_ids: list[str]) -> None:
    """Delete snapshot keys (used on chart delete or dataset SQL change)."""
    if not chart_ids or _cb_is_open():
        return
    try:
        await get_redis().delete(*[_key(cid) for cid in chart_ids])
        _cb_reset()
        logger.debug("[snapshot_cache] deleted %d key(s)", len(chart_ids))
    except Exception as exc:
        _cb_trip()
        logger.warning("[snapshot_cache] delete failed: %s", exc)
