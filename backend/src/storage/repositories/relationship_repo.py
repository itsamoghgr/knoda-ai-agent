from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.relationship import Relationship, RelationshipSource
from storage.orm.relationship import RelationshipORM


class RelationshipRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def save_many(self, job_id: str, relationships: list[Relationship]) -> None:
        for rel in relationships:
            orm = RelationshipORM(
                job_id=job_id,
                from_database=rel.from_database,
                from_schema=rel.from_schema,
                from_table=rel.from_table,
                from_column=rel.from_column,
                to_database=rel.to_database,
                to_schema=rel.to_schema,
                to_table=rel.to_table,
                to_column=rel.to_column,
                confidence=rel.confidence,
                source=rel.source.value,
            )
            self._db.add(orm)
        await self._db.commit()

    async def list_by_job(self, job_id: str) -> list[Relationship]:
        result = await self._db.execute(
            select(RelationshipORM).where(RelationshipORM.job_id == job_id)
        )
        return [self._to_model(row) for row in result.scalars().all()]

    @staticmethod
    def _to_model(orm: RelationshipORM) -> Relationship:
        return Relationship(
            from_database=orm.from_database,
            from_schema=orm.from_schema,
            from_table=orm.from_table,
            from_column=orm.from_column,
            to_database=orm.to_database,
            to_schema=orm.to_schema,
            to_table=orm.to_table,
            to_column=orm.to_column,
            confidence=orm.confidence,
            source=RelationshipSource(orm.source),
        )
