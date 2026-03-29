from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.semantic import (
    Dimension,
    DimensionType,
    Entity,
    EntityType,
    Measure,
    MeasureAgg,
    SemanticModel,
)
from storage.orm.semantic import (
    DimensionORM,
    EntityORM,
    MeasureORM,
    SemanticModelORM,
    SemanticSnapshotORM,
)


class SemanticRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def save_model(self, job_id: str, model: SemanticModel) -> str:
        orm = SemanticModelORM(
            job_id=job_id,
            database_name=model.database_name,
            schema_name=model.schema_name,
            table_name=model.table_name,
            description=model.description,
            table_type=model.table_type,
            grain=model.grain,
        )
        self._db.add(orm)
        await self._db.flush()

        for entity in model.entities:
            self._db.add(
                EntityORM(
                    model_id=orm.id,
                    name=entity.name,
                    entity_type=entity.entity_type.value,
                    column_name=entity.column_name,
                    description=entity.description,
                )
            )

        for dim in model.dimensions:
            self._db.add(
                DimensionORM(
                    model_id=orm.id,
                    name=dim.name,
                    dim_type=dim.dim_type.value,
                    column_name=dim.column_name,
                    description=dim.description,
                    time_granularity=dim.time_granularity,
                )
            )

        for measure in model.measures:
            self._db.add(
                MeasureORM(
                    model_id=orm.id,
                    name=measure.name,
                    agg=measure.agg.value,
                    expr=measure.expr,
                    description=measure.description,
                )
            )

        await self._db.commit()
        return orm.id

    async def list_models(self, job_id: str) -> list[SemanticModel]:
        result = await self._db.execute(
            select(SemanticModelORM)
            .where(SemanticModelORM.job_id == job_id)
            .options(
                selectinload(SemanticModelORM.entities),
                selectinload(SemanticModelORM.dimensions),
                selectinload(SemanticModelORM.measures),
            )
            .order_by(SemanticModelORM.schema_name, SemanticModelORM.table_name)
        )
        return [self._to_model(row) for row in result.scalars().all()]

    async def list_all_models(self) -> list[tuple[str, SemanticModel]]:
        """Load semantic models for ALL jobs (used by global chat).
        Returns list of (job_id, model) tuples so the caller can group by job.
        """
        result = await self._db.execute(
            select(SemanticModelORM)
            .options(
                selectinload(SemanticModelORM.entities),
                selectinload(SemanticModelORM.dimensions),
                selectinload(SemanticModelORM.measures),
            )
            .order_by(SemanticModelORM.job_id, SemanticModelORM.schema_name, SemanticModelORM.table_name)
        )
        return [(row.job_id, self._to_model(row)) for row in result.scalars().all()]

    async def save_snapshot(self, job_id: str, yaml_content: str) -> str:
        # Replace existing snapshot for this job if one exists
        result = await self._db.execute(
            select(SemanticSnapshotORM).where(SemanticSnapshotORM.job_id == job_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.yaml_content = yaml_content
            await self._db.commit()
            return existing.id

        orm = SemanticSnapshotORM(job_id=job_id, yaml_content=yaml_content)
        self._db.add(orm)
        await self._db.commit()
        return orm.id

    async def get_snapshot(self, job_id: str) -> str | None:
        result = await self._db.execute(
            select(SemanticSnapshotORM).where(SemanticSnapshotORM.job_id == job_id)
        )
        orm = result.scalar_one_or_none()
        return orm.yaml_content if orm else None

    @staticmethod
    def _to_model(orm: SemanticModelORM) -> SemanticModel:
        return SemanticModel(
            database_name=orm.database_name,
            schema_name=orm.schema_name,
            table_name=orm.table_name,
            description=orm.description,
            table_type=orm.table_type,
            grain=orm.grain,
            entities=[
                Entity(
                    name=e.name,
                    entity_type=EntityType(e.entity_type),
                    column_name=e.column_name,
                    description=e.description,
                )
                for e in orm.entities
            ],
            dimensions=[
                Dimension(
                    name=d.name,
                    dim_type=DimensionType(d.dim_type),
                    column_name=d.column_name,
                    description=d.description,
                    time_granularity=d.time_granularity,
                )
                for d in orm.dimensions
            ],
            measures=[
                Measure(
                    name=m.name,
                    agg=MeasureAgg(m.agg),
                    expr=m.expr,
                    description=m.description,
                )
                for m in orm.measures
            ],
        )
