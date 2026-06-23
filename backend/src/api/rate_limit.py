"""Shared rate limiter instance.

Import `limiter` from this module in both main.py and routers to avoid
circular imports. Keys requests by hashed Bearer token (user identity)
with IP address as fallback.
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING

from slowapi import Limiter
from slowapi.util import get_remote_address

from config import settings

if TYPE_CHECKING:
    from fastapi import Request

logger = logging.getLogger(__name__)


def _rate_key(request: Request) -> str:
    """Key by hashed Bearer token for per-user limiting, fallback to IP."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        # Hash the token so the raw JWT is never stored in Redis
        return hashlib.sha256(auth[7:].encode()).hexdigest()[:16]
    return get_remote_address(request)


def _make_limiter() -> Limiter:
    """Create the rate limiter, falling back to in-memory if Redis is unreachable.

    The cloud Redis (rediss://) is only reachable from within the production VPC.
    In local dev it times out, causing every request to fail before the agent runs.
    In-memory storage is sufficient for single-process local development.
    """
    redis_url = settings.redis_url
    # Only attempt Redis-backed limiting for non-TLS URLs that are likely local/reachable.
    # TLS rediss:// URLs are cloud-only and will timeout locally.
    if not redis_url.startswith("rediss://"):
        try:
            return Limiter(key_func=_rate_key, storage_uri=redis_url)
        except Exception as exc:
            logger.warning("Rate limiter: could not connect to Redis (%s) — using in-memory", exc)

    logger.info("Rate limiter: using in-memory storage (cloud Redis not available locally)")
    return Limiter(key_func=_rate_key)


limiter = _make_limiter()
