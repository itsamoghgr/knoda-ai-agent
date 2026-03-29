from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.profile import ColumnProfile, ProfileResult
from storage.orm.profile import ColumnProfileORM, ProfileResultORM


class ProfileRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def save_profile(self, job_id: str, profile: ProfileResult) -> str:
        orm = ProfileResultORM(
            job_id=job_id,
            database_name=profile.database_name,
            schema_name=profile.schema_name,
            table_name=profile.table_name,
            row_count=profile.row_count,
            sample_rows=profile.sample_rows,
        )
        self._db.add(orm)
        await self._db.flush()

        for col in profile.column_profiles:
            col_orm = ColumnProfileORM(
                profile_result_id=orm.id,
                column_name=col.column_name,
                column_type=col.column_type,
                row_count=col.row_count,
                null_count=col.null_count,
                null_percentage=col.null_percentage,
                approx_unique=col.approx_unique,
                min_val=col.min_val,
                max_val=col.max_val,
                avg=col.avg,
                std=col.std,
                q25=col.q25,
                q50=col.q50,
                q75=col.q75,
                sample_values=col.sample_values,
            )
            self._db.add(col_orm)

        await self._db.commit()
        return orm.id

    async def get_profiles(self, job_id: str) -> list[ProfileResult]:
        result = await self._db.execute(
            select(ProfileResultORM)
            .where(ProfileResultORM.job_id == job_id)
            .options(selectinload(ProfileResultORM.column_profiles))
        )
        return [self._to_model(row) for row in result.scalars().all()]

    @staticmethod
    def _to_model(orm: ProfileResultORM) -> ProfileResult:
        return ProfileResult(
            database_name=orm.database_name,
            schema_name=orm.schema_name,
            table_name=orm.table_name,
            row_count=orm.row_count,
            sample_rows=orm.sample_rows or [],
            column_profiles=[
                ColumnProfile(
                    column_name=c.column_name,
                    column_type=c.column_type,
                    row_count=c.row_count,
                    null_count=c.null_count,
                    null_percentage=c.null_percentage,
                    approx_unique=c.approx_unique,
                    min_val=c.min_val,
                    max_val=c.max_val,
                    avg=c.avg,
                    std=c.std,
                    q25=c.q25,
                    q50=c.q50,
                    q75=c.q75,
                    sample_values=c.sample_values or [],
                )
                for c in orm.column_profiles
            ],
        )
