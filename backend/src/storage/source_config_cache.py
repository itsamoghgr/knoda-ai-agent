"""In-memory cache of source configs keyed by (tenant_id, job_id).

Populated when a job is created and cleared when a job is deleted.
This allows the chat agent to re-attach databases for live SQL queries
without storing credentials in the database on every request.

Note: this cache is not persisted across server restarts. If the server
restarts, the agent will fall back to schema-only mode for existing jobs
until they are re-run.
"""

import threading
from typing import Any

_lock = threading.Lock()
_configs: dict[str, Any] = {}  # "{tenant_id}:{job_id}" → SourceConfig


def _key(tenant_id: str, job_id: str) -> str:
    return f"{tenant_id}:{job_id}"


def store(job_id: str, config: Any, tenant_id: str = "") -> None:
    """Store a source config for a job."""
    with _lock:
        _configs[_key(tenant_id, job_id)] = config


def get(job_id: str, tenant_id: str = "") -> Any | None:
    """Retrieve the source config for a job, or None if not cached."""
    with _lock:
        return _configs.get(_key(tenant_id, job_id))


def remove(job_id: str, tenant_id: str = "") -> None:
    """Remove the source config for a job."""
    with _lock:
        _configs.pop(_key(tenant_id, job_id), None)


def all_configs() -> dict[str, Any]:
    """Return a snapshot of all cached entries."""
    with _lock:
        return dict(_configs)
