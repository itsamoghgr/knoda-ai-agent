"""Repository for recording and querying LLM token usage."""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from storage.orm.token_usage import TokenUsageORM


class TokenUsageRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def record(
        self,
        provider: str,
        model: str,
        context: str,
        input_tokens: int,
        output_tokens: int,
        job_id: str | None = None,
    ) -> None:
        """Insert one token usage record. Silently skips if all counts are zero."""
        if input_tokens == 0 and output_tokens == 0:
            return
        orm = TokenUsageORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            job_id=job_id,
            provider=provider,
            model=model,
            context=context,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            created_at=datetime.utcnow(),
        )
        self._db.add(orm)
        await self._db.commit()

    async def list_calls(self, limit: int = 200) -> list[dict]:
        """Return individual token usage records, most recent first."""
        from sqlalchemy import desc
        result = await self._db.execute(
            select(TokenUsageORM)
            .where(TokenUsageORM.tenant_id == self._tenant_id)
            .order_by(desc(TokenUsageORM.created_at))
            .limit(limit)
        )
        rows = result.scalars().all()
        return [
            {
                "id": r.id,
                "provider": r.provider,
                "model": r.model,
                "context": r.context,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "total_tokens": r.total_tokens,
                "job_id": r.job_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]

    async def get_totals(self) -> dict:
        """Return aggregated token usage totals for this tenant."""
        result = await self._db.execute(
            select(
                func.coalesce(func.sum(TokenUsageORM.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(TokenUsageORM.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(TokenUsageORM.total_tokens), 0).label("total_tokens"),
            ).where(TokenUsageORM.tenant_id == self._tenant_id)
        )
        row = result.one()

        ctx_result = await self._db.execute(
            select(
                TokenUsageORM.context,
                func.coalesce(func.sum(TokenUsageORM.total_tokens), 0).label("tokens"),
            )
            .where(TokenUsageORM.tenant_id == self._tenant_id)
            .group_by(TokenUsageORM.context)
        )
        by_context: dict[str, int] = {r.context: int(r.tokens) for r in ctx_result.all()}

        return {
            "input_tokens": int(row.input_tokens),
            "output_tokens": int(row.output_tokens),
            "total_tokens": int(row.total_tokens),
            "by_context": {
                "discovery": by_context.get("discovery", 0),
                "agent": by_context.get("agent", 0),
                "chat": by_context.get("chat", 0),
                "communication_agent": by_context.get("communication_agent", 0),
            },
        }
