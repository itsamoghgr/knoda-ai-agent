"""Conversations API router — serves the conversation history audit log.

Endpoints:
  GET  /conversations/sessions           → list all sessions for the tenant
  GET  /conversations/sessions/{id}      → get all messages in a session
  GET  /conversations/search?q=query     → full-text search across history
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.dependencies import get_current_user, get_db
from storage.repositories.long_term_repo import ConversationRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/conversations", tags=["conversations"])


def _message_to_dict(msg) -> dict[str, Any]:
    return {
        "id": msg.id,
        "session_id": msg.session_id,
        "role": msg.role,
        "content": msg.content,
        "channel": msg.channel,
        "tool_calls": msg.tool_calls,
        "dataset_id": msg.dataset_id,
        "chart_id": msg.chart_id,
        "job_id": msg.job_id,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """List all conversation sessions for the authenticated tenant, most recent first."""
    repo = ConversationRepository(db, str(user.id))
    raw = await repo.list_sessions(limit=limit)
    sessions = [
        {
            "session_id": s["session_id"],
            "message_count": s["message_count"],
            "last_message_at": s["last_message_at"],
            "preview": s.get("first_user_message", ""),
            "title": s.get("title"),
            "job_id": None,
        }
        for s in raw
    ]
    return {"sessions": sessions, "count": len(sessions)}


class SetTitleRequest(BaseModel):
    title: str


@router.put("/sessions/{session_id}/title")
async def set_session_title(
    session_id: str,
    body: SetTitleRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    """Set or update the display title for a conversation session."""
    repo = ConversationRepository(db, str(user.id))
    await repo.set_session_title(session_id, body.title.strip()[:80])
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    """Delete all messages in a conversation session."""
    repo = ConversationRepository(db, str(user.id))
    count = await repo.delete_session(session_id)
    return {"deleted": session_id, "messages_removed": count}


@router.get("/sessions/{session_id}")
async def get_session_messages(
    session_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return the full conversation for a specific session, in chronological order.

    Both user messages (role='user') and AI responses (role='assistant') are
    included. Assistant messages include tool_calls metadata — which SQL was run,
    which charts were created, etc.
    """
    repo = ConversationRepository(db, str(user.id))
    messages = await repo.get_session_messages(session_id=session_id, limit=limit)
    if not messages:
        raise HTTPException(
            status_code=404,
            detail=f"No messages found for session '{session_id}'",
        )
    return {
        "session_id": session_id,
        "messages": [_message_to_dict(m) for m in messages],
        "count": len(messages),
    }


@router.get("/search")
async def search_conversations(
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Search across all conversation history for this tenant.

    Searches user messages only (not AI responses). Returns matching messages
    with their session_id so the caller can load the full session if needed.
    """
    repo = ConversationRepository(db, str(user.id))
    messages = await repo.search_messages(query=q, limit=limit)
    return {
        "query": q,
        "results": [_message_to_dict(m) for m in messages],
        "count": len(messages),
    }
