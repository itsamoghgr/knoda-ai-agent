"""Async Redis client — shared connection pool for the entire application.

Usage:
    from storage.redis_client import get_redis

    redis = get_redis()
    await redis.set("key", "value", ex=3600)
    value = await redis.get("key")

For LangGraph short-term memory (session checkpointing):
    from storage.redis_client import get_checkpointer

    checkpointer = get_checkpointer()
    # Pass to create_react_agent(..., checkpointer=checkpointer)
    # Thread ID: "{tenant_id}:{job_id}:{session_id}"

Call close_redis() from the FastAPI lifespan shutdown to release connections.
"""

from __future__ import annotations

import logging

import redis.asyncio as aioredis

from config import settings

logger = logging.getLogger(__name__)

_pool: aioredis.Redis | None = None
_checkpointer = None  # LangGraph Redis checkpointer (lazy init)


def get_redis() -> aioredis.Redis:
    """Return the shared async Redis client, creating the pool on first call."""
    global _pool
    if _pool is None:
        kwargs: dict = dict(
            decode_responses=True,  # all values returned as str, not bytes
            encoding="utf-8",
            socket_connect_timeout=2,  # fail fast when Redis is unreachable
            socket_timeout=2,  # fail fast on hung operations
            retry_on_timeout=False,  # don't retry — let caller handle gracefully
        )
        if settings.redis_url.startswith("rediss://"):
            # DigitalOcean managed Redis uses TLS (rediss://) but its CA cert is not
            # in most server/Docker trust stores. Skip certificate chain validation
            # (safe on a private VPC). Use ssl_cert_reqs/ssl_check_hostname instead
            # of ssl_context for broad redis-py version compatibility.
            kwargs["ssl_cert_reqs"] = None
            kwargs["ssl_check_hostname"] = False
        _pool = aioredis.from_url(settings.redis_url, **kwargs)
        logger.info("Redis pool created: %s", settings.redis_url.split("@")[-1])
    return _pool


def get_checkpointer():
    """Return a LangGraph-compatible Redis checkpointer for short-term session memory.

    Uses a separate key namespace ("checkpoint:") from the snapshot cache ("snapshot:")
    so there is no key collision.

    The checkpointer enables conversational continuity across turns:
      - Thread ID format: "{tenant_id}:{job_id}:{session_id}"
      - TTL: 24 hours (set per-write via the checkpointer's TTL config)

    Returns None if langgraph-checkpoint-redis is not installed (graceful degradation
    to stateless mode — existing behavior before v2).
    """
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer
    try:
        from langgraph.checkpoint.redis.aio import AsyncRedisSaver  # type: ignore[import]

        # For TLS Redis (rediss://), pass ssl kwargs that redis-py 7.x accepts.
        # from_conn_string passes ssl_context= which was removed in redis-py 7.x.
        if settings.redis_url.startswith("rediss://"):
            _checkpointer = AsyncRedisSaver(
                redis_client=aioredis.from_url(
                    settings.redis_url,
                    ssl_cert_reqs=None,
                    ssl_check_hostname=False,
                    decode_responses=False,  # checkpointer needs bytes
                )
            )
        else:
            _checkpointer = AsyncRedisSaver(redis_url=settings.redis_url)
        logger.info("LangGraph Redis checkpointer initialised")
    except ImportError:
        logger.warning(
            "langgraph-checkpoint-redis not installed — short-term memory disabled. "
            "Run: uv add langgraph-checkpoint-redis"
        )
        _checkpointer = None
    return _checkpointer


async def close_redis() -> None:
    """Gracefully close the Redis connection pool. Call from app lifespan shutdown."""
    global _pool, _checkpointer
    if _pool is not None:
        await _pool.aclose()
        _pool = None
        logger.info("Redis pool closed")
    _checkpointer = None
