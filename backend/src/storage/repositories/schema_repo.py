from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.schema import ColumnMeta, TableMeta
from storage.orm.schema import ColumnMetaORM, TableMetaORM


class SchemaRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def save_table(self, job_id: str, table: TableMeta) -> str:
        orm = TableMetaORM(
            job_id=job_id,
            database_name=table.database_name,
            schema_name=table.schema_name,
            table_name=table.table_name,
            column_count=table.column_count,
            row_estimate=table.row_estimate,
        )
        self._db.add(orm)
        await self._db.flush()

        for col in table.columns:
            col_orm = ColumnMetaORM(
                table_id=orm.id,
                column_name=col.column_name,
                column_type=col.column_type,
                is_nullable=col.is_nullable,
                column_default=col.column_default,
                ordinal_position=col.ordinal_position,
                is_primary_key=col.is_primary_key,
                foreign_key_ref=col.foreign_key_ref,
            )
            self._db.add(col_orm)

        await self._db.commit()
        return orm.id

    async def list_tables(self, job_id: str) -> list[TableMeta]:
        result = await self._db.execute(
            select(TableMetaORM)
            .where(TableMetaORM.job_id == job_id)
            .options(selectinload(TableMetaORM.columns))
            .order_by(TableMetaORM.schema_name, TableMetaORM.table_name)
        )
        return [self._to_model(row) for row in result.scalars().all()]

    @staticmethod
    def _to_model(orm: TableMetaORM) -> TableMeta:
        return TableMeta(
            database_name=orm.database_name,
            schema_name=orm.schema_name,
            table_name=orm.table_name,
            column_count=orm.column_count,
            row_estimate=orm.row_estimate,
            columns=[
                ColumnMeta(
                    column_name=c.column_name,
                    column_type=c.column_type,
                    is_nullable=c.is_nullable,
                    column_default=c.column_default,
                    ordinal_position=c.ordinal_position,
                    is_primary_key=c.is_primary_key,
                    foreign_key_ref=c.foreign_key_ref,
                )
                for c in sorted(orm.columns, key=lambda x: x.ordinal_position)
            ],
        )
