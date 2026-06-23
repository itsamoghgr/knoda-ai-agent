"""Long-term memory repositories — v2 agent memory.

Two repositories:
  LongTermMemoryRepository  — dataset intent cards (semantic query reuse layer)
  ConversationRepository    — per-turn conversation audit log + session listing
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select, text

from storage.orm.long_term import (
    ConversationMessageORM,
    ConversationSessionTitleORM,
    ConversationSummaryORM,
    DatasetIntentCardORM,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LongTermMemoryRepository
# ---------------------------------------------------------------------------


class LongTermMemoryRepository:
    """Manages dataset intent cards — the semantic query-reuse layer.

    When the Analyst has a question, it searches here BEFORE writing SQL.
    If a similar query was answered before, it reuses the existing dataset.

    Ranking formula: similarity × log(times_accessed + 1) × recency_decay
    where recency_decay = 1 / (1 + days_since_last_access / 30)
    """

    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def save_intent_card(
        self,
        dataset_id: str | None,
        description: str,
        tables_used: list[str],
        embedding: list[float] | None = None,
        chart_id: str | None = None,
    ) -> DatasetIntentCardORM:
        """Persist a new dataset intent card after a successful query."""
        orm = DatasetIntentCardORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            dataset_id=dataset_id,
            chart_id=chart_id,
            description=description,
            tables_used=tables_used,
            times_accessed=0,
            last_accessed=None,
            created_at=datetime.now(UTC),
        )
        self._db.add(orm)
        await self._db.flush()  # get the id before the embedding update

        # Store embedding via raw SQL (pgvector)
        if embedding is not None:
            try:
                vector_str = "[" + ",".join(str(x) for x in embedding) + "]"
                await self._db.execute(
                    text(
                        f"UPDATE dataset_intent_cards "
                        f"SET embedding = '{vector_str}'::vector "
                        "WHERE id = :id"
                    ),
                    {"id": orm.id},
                )
            except Exception as exc:
                logger.warning("Failed to store intent card embedding: %s", exc)

        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def find_similar(
        self,
        question_embedding: list[float],
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Return top-k intent cards ranked by semantic similarity × popularity × recency.

        Returns a list of dicts with keys:
          id, dataset_id, chart_id, description, tables_used,
          times_accessed, similarity_score
        """
        try:
            vector_str = "[" + ",".join(str(x) for x in question_embedding) + "]"

            # Ranked retrieval: similarity × log(times_accessed+1) × recency decay
            # Note: vector_str is interpolated directly (safe — it's a float array we built)
            # to avoid SQLAlchemy's :name bind-param syntax conflicting with ::vector cast.
            sql = text(f"""
                SELECT
                    id,
                    dataset_id,
                    chart_id,
                    description,
                    tables_used,
                    times_accessed,
                    1 - (embedding <=> '{vector_str}'::vector) AS similarity,
                    (
                        (1 - (embedding <=> '{vector_str}'::vector))
                        * LOG(times_accessed + 2)
                        * (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at))) / 2592000.0))
                    ) AS score
                FROM dataset_intent_cards
                WHERE tenant_id = :tenant_id
                  AND embedding IS NOT NULL
                  AND dataset_id IS NOT NULL
                ORDER BY score DESC
                LIMIT :top_k
            """)

            result = await self._db.execute(
                sql,
                {
                    "tenant_id": self._tenant_id,
                    "top_k": top_k,
                },
            )
            rows = result.fetchall()
            return [
                {
                    "id": r.id,
                    "dataset_id": r.dataset_id,
                    "chart_id": r.chart_id,
                    "description": r.description,
                    "tables_used": r.tables_used or [],
                    "times_accessed": r.times_accessed,
                    "similarity_score": float(r.similarity),
                }
                for r in rows
            ]
        except Exception as exc:
            logger.warning("find_similar failed (no pgvector?): %s", exc)
            return []

    async def record_access(self, card_id: str) -> None:
        """Increment usage counter and update last_accessed timestamp on cache hit."""
        try:
            await self._db.execute(
                text(
                    "UPDATE dataset_intent_cards "
                    "SET times_accessed = times_accessed + 1, "
                    "    last_accessed = NOW() "
                    "WHERE id = :id AND tenant_id = :tenant_id"
                ),
                {"id": card_id, "tenant_id": self._tenant_id},
            )
            await self._db.commit()
        except Exception as exc:
            logger.warning("record_access failed for card %s: %s", card_id, exc)

    async def update_dataset(self, card_id: str, dataset_id: str) -> None:
        """Update the dataset pointer on an existing intent card (self-healing reuse)."""
        try:
            await self._db.execute(
                text(
                    "UPDATE dataset_intent_cards "
                    "SET dataset_id = :dataset_id "
                    "WHERE id = :id AND tenant_id = :tenant_id"
                ),
                {
                    "id": card_id,
                    "dataset_id": dataset_id,
                    "tenant_id": self._tenant_id,
                },
            )
            await self._db.commit()
        except Exception as exc:
            logger.warning("update_dataset failed for card %s: %s", card_id, exc)


# ---------------------------------------------------------------------------
# ConversationRepository
# ---------------------------------------------------------------------------


class ConversationRepository:
    """Manages the full per-turn conversation audit log.

    Both the user's message (role='user') and the AI's response (role='assistant')
    are stored. The assistant row includes the tool_calls JSONB for full auditability.
    """

    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        job_id: str | None = None,
        channel: str = "chat",
        tool_calls: dict | None = None,
        dataset_id: str | None = None,
        chart_id: str | None = None,
    ) -> ConversationMessageORM:
        """Persist a single conversation turn (user or assistant message)."""
        orm = ConversationMessageORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            session_id=session_id,
            job_id=job_id,
            role=role,
            content=content,
            channel=channel,
            tool_calls=tool_calls,
            dataset_id=dataset_id,
            chart_id=chart_id,
            created_at=datetime.now(UTC),
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def list_sessions(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return distinct sessions for this tenant, most recent first.

        Each entry includes: session_id, title (if set), last message preview,
        message count, and the timestamp of the most recent message.
        """
        sql = text("""
            SELECT
                cm1.session_id,
                COUNT(*) AS message_count,
                MAX(cm1.created_at) AS last_message_at,
                (
                    SELECT content
                    FROM conversation_messages cm2
                    WHERE cm2.tenant_id = :tenant_id
                      AND cm2.session_id = cm1.session_id
                      AND cm2.role = 'user'
                    ORDER BY created_at ASC
                    LIMIT 1
                ) AS first_user_message,
                cst.title AS title
            FROM conversation_messages cm1
            LEFT JOIN conversation_session_titles cst
                ON cst.session_id = cm1.session_id AND cst.tenant_id = :tenant_id
            WHERE cm1.tenant_id = :tenant_id
            GROUP BY cm1.session_id, cst.title
            ORDER BY last_message_at DESC
            LIMIT :limit
        """)
        result = await self._db.execute(sql, {"tenant_id": self._tenant_id, "limit": limit})
        rows = result.fetchall()
        return [
            {
                "session_id": r.session_id,
                "message_count": r.message_count,
                "last_message_at": r.last_message_at.isoformat() if r.last_message_at else None,
                "first_user_message": (r.first_user_message or "")[:120],
                "title": r.title,
            }
            for r in rows
        ]

    async def set_session_title(self, session_id: str, title: str) -> None:
        """Upsert a human-readable title for a session."""
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        stmt = (
            pg_insert(ConversationSessionTitleORM)
            .values(
                session_id=session_id,
                tenant_id=self._tenant_id,
                title=title,
            )
            .on_conflict_do_update(
                index_elements=["session_id"],
                set_={"title": title},
            )
        )
        await self._db.execute(stmt)
        await self._db.commit()

    async def delete_session(self, session_id: str) -> int:
        """Delete all messages for a session. Returns count of deleted rows."""
        from sqlalchemy import delete as sa_delete

        result = await self._db.execute(
            sa_delete(ConversationMessageORM).where(
                ConversationMessageORM.tenant_id == self._tenant_id,
                ConversationMessageORM.session_id == session_id,
            )
        )
        # Also remove the title if it exists
        await self._db.execute(
            sa_delete(ConversationSessionTitleORM).where(
                ConversationSessionTitleORM.tenant_id == self._tenant_id,
                ConversationSessionTitleORM.session_id == session_id,
            )
        )
        await self._db.commit()
        return result.rowcount

    async def get_session_messages(
        self,
        session_id: str,
        limit: int = 200,
    ) -> list[ConversationMessageORM]:
        """Return all messages for a session, oldest first (chronological order)."""
        result = await self._db.execute(
            select(ConversationMessageORM)
            .where(
                ConversationMessageORM.tenant_id == self._tenant_id,
                ConversationMessageORM.session_id == session_id,
            )
            .order_by(ConversationMessageORM.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def search_messages(
        self,
        query: str,
        limit: int = 20,
    ) -> list[ConversationMessageORM]:
        """Full-text search across a tenant's conversation history."""
        result = await self._db.execute(
            select(ConversationMessageORM)
            .where(
                ConversationMessageORM.tenant_id == self._tenant_id,
                ConversationMessageORM.role == "user",
                ConversationMessageORM.content.ilike(f"%{query}%"),
            )
            .order_by(ConversationMessageORM.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def save_summary(
        self,
        session_id: str,
        summary: str,
    ) -> ConversationSummaryORM:
        """Persist a compressed AI summary of a completed session."""
        orm = ConversationSummaryORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            session_id=session_id,
            summary=summary,
            created_at=datetime.now(UTC),
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def get_recent_summaries(
        self,
        limit: int = 5,
    ) -> list[ConversationSummaryORM]:
        """Return the most recent session summaries for context recall."""
        result = await self._db.execute(
            select(ConversationSummaryORM)
            .where(ConversationSummaryORM.tenant_id == self._tenant_id)
            .order_by(ConversationSummaryORM.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
