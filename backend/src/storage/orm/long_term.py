"""ORM models for v2 long-term memory tables.

Three tables:
  • dataset_intent_cards  — semantic reuse layer (pointer to datasets + embedding)
  • conversation_summaries — compressed AI recall between sessions
  • conversation_messages  — full per-turn audit log (both user + assistant turns)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from storage.database import Base

try:
    from pgvector.sqlalchemy import Vector
    _VECTOR_TYPE = Vector(1536)
except ImportError:
    _VECTOR_TYPE = sa.Text()


class DatasetIntentCardORM(Base):
    """Semantic reuse layer — links a natural-language intent description to a dataset.

    When the Analyst searches long-term memory for similar past queries, it uses
    the embedding column for vector similarity and ranks by times_accessed + recency.
    """

    __tablename__ = "dataset_intent_cards"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    dataset_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    chart_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("charts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    description: Mapped[str] = mapped_column(sa.Text, nullable=False)
    tables_used: Mapped[list[str]] = mapped_column(
        sa.ARRAY(sa.Text), nullable=False, server_default="{}"
    )
    times_accessed: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default="0"
    )
    last_accessed: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )

    __table_args__ = (
        sa.Index("ix_intent_cards_tenant_id", "tenant_id"),
    )


class ConversationSummaryORM(Base):
    """Compressed AI-generated summary of a past session.

    Written at session end. Read by the Analyst at session start as context
    for what was discussed previously across sessions.
    """

    __tablename__ = "conversation_summaries"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    session_id: Mapped[str] = mapped_column(sa.Text, nullable=False, index=True)
    summary: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class ConversationMessageORM(Base):
    """Full per-turn audit log of every user and assistant message.

    Both sides of every conversation are persisted here:
      role = 'user'      → the human's question/input
      role = 'assistant' → the AI's response (text + tool usage metadata)

    This table is the source of truth for the user-facing conversation history UI.
    """

    __tablename__ = "conversation_messages"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    session_id: Mapped[str] = mapped_column(
        sa.Text, nullable=False, index=True
    )
    job_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        sa.String(32), nullable=False
    )  # 'user' | 'assistant'
    content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    channel: Mapped[str] = mapped_column(
        sa.String(32), nullable=False, server_default="chat"
    )  # 'chat' | 'slack' | 'meeting' | 'email'
    tool_calls: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True
    )  # agent tool calls made during this turn (assistant turns only)
    dataset_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("datasets.id", ondelete="SET NULL"),
        nullable=True,
    )
    chart_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("charts.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )

    __table_args__ = (
        sa.Index("ix_conv_messages_tenant_session", "tenant_id", "session_id"),
        sa.Index("ix_conv_messages_tenant_time", "tenant_id", "created_at"),
    )


class ConversationSessionTitleORM(Base):
    """One-liner title for a conversation session, set after the first turn.

    Stored in a separate lightweight table so we don't touch the large
    conversation_messages table. Falls back to the first user message preview
    if no title has been generated yet.
    """

    __tablename__ = "conversation_session_titles"

    session_id: Mapped[str] = mapped_column(sa.Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
