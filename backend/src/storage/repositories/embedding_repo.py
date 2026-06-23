"""Repository for table embedding vectors (pgvector semantic search)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import delete, select, text

from storage.orm.embedding import TableEmbeddingORM

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class EmbeddingRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def upsert(
        self,
        job_id: str,
        schema_name: str,
        table_name: str,
        embedding: list[float],
        text_content: str,
        model: str,
    ) -> None:
        """Insert or replace the embedding for (job_id, schema_name, table_name)."""
        await self._db.execute(
            delete(TableEmbeddingORM).where(
                TableEmbeddingORM.tenant_id == self._tenant_id,
                TableEmbeddingORM.job_id == job_id,
                TableEmbeddingORM.schema_name == schema_name,
                TableEmbeddingORM.table_name == table_name,
            )
        )

        row = TableEmbeddingORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            job_id=job_id,
            schema_name=schema_name,
            table_name=table_name,
            text_content=text_content,
            model=model,
            created_at=datetime.utcnow(),
        )
        self._db.add(row)

        await self._db.flush()
        vector_str = "[" + ",".join(str(v) for v in embedding) + "]"
        await self._db.execute(
            text(
                f"UPDATE table_embeddings SET embedding = '{vector_str}'::vector WHERE id = :row_id"
            ),
            {"row_id": row.id},
        )
        await self._db.commit()

    async def search(
        self,
        query_embedding: list[float],
        job_id: str | None = None,
        top_k: int = 10,
    ) -> list[TableEmbeddingORM]:
        """Return top-K most similar table embeddings by cosine distance."""
        vector_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

        if job_id:
            sql = text(
                "SELECT id, tenant_id, job_id, schema_name, table_name, text_content, model, created_at "
                "FROM table_embeddings "
                "WHERE tenant_id = :tenant_id AND job_id = :job_id "
                f"ORDER BY embedding <=> '{vector_str}'::vector "
                "LIMIT :k"
            )
            result = await self._db.execute(
                sql, {"tenant_id": self._tenant_id, "job_id": job_id, "k": top_k}
            )
        else:
            sql = text(
                "SELECT id, tenant_id, job_id, schema_name, table_name, text_content, model, created_at "
                "FROM table_embeddings "
                "WHERE tenant_id = :tenant_id "
                f"ORDER BY embedding <=> '{vector_str}'::vector "
                "LIMIT :k"
            )
            result = await self._db.execute(sql, {"tenant_id": self._tenant_id, "k": top_k})

        rows = result.fetchall()
        return [_row_to_orm(r) for r in rows]

    async def count(self, job_id: str) -> int:
        """How many embeddings exist for this job."""
        result = await self._db.execute(
            select(TableEmbeddingORM).where(
                TableEmbeddingORM.tenant_id == self._tenant_id,
                TableEmbeddingORM.job_id == job_id,
            )
        )
        return len(result.scalars().all())

    async def delete_by_job(self, job_id: str) -> None:
        """Remove all embeddings for a job (called on job delete)."""
        await self._db.execute(
            delete(TableEmbeddingORM).where(
                TableEmbeddingORM.tenant_id == self._tenant_id,
                TableEmbeddingORM.job_id == job_id,
            )
        )
        await self._db.commit()


def _row_to_orm(row) -> TableEmbeddingORM:
    orm = TableEmbeddingORM.__new__(TableEmbeddingORM)
    orm.id = row.id
    orm.tenant_id = row.tenant_id
    orm.job_id = row.job_id
    orm.schema_name = row.schema_name
    orm.table_name = row.table_name
    orm.text_content = row.text_content
    orm.model = row.model
    orm.created_at = row.created_at
    return orm
