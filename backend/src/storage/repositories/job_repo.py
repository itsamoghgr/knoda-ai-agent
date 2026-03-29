from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.job import Job, JobStatus
from storage.orm.job import JobORM


class JobRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def create(self, job: Job, source_config: dict | None = None) -> Job:
        orm = JobORM(
            id=job.id,
            tenant_id=self._tenant_id,
            status=job.status.value,
            source_type=job.source_type,
            source_config_safe=job.source_config_safe,
            source_config=source_config,
            tables_total=job.tables_total,
            tables_processed=job.tables_processed,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return self._to_model(orm)

    async def get_source_config(self, job_id: str) -> dict | None:
        """Return the full source config (with credentials) for a job, or None."""
        result = await self._db.execute(
            select(JobORM).where(
                JobORM.id == job_id,
                JobORM.tenant_id == self._tenant_id,
            )
        )
        orm = result.scalar_one_or_none()
        if orm is None:
            return None
        return orm.source_config

    async def list_all_source_configs(self) -> dict[str, dict]:
        """Return {job_id: source_config} for all completed jobs that have a stored config."""
        result = await self._db.execute(
            select(JobORM.id, JobORM.source_config).where(
                JobORM.tenant_id == self._tenant_id,
                JobORM.status == JobStatus.COMPLETED.value,
                JobORM.source_config.isnot(None),
            )
        )
        return {row.id: row.source_config for row in result.all()}

    async def get(self, job_id: str) -> Job | None:
        result = await self._db.execute(
            select(JobORM).where(
                JobORM.id == job_id,
                JobORM.tenant_id == self._tenant_id,
            )
        )
        orm = result.scalar_one_or_none()
        return self._to_model(orm) if orm else None

    async def list_all(self, limit: int = 50) -> list[Job]:
        result = await self._db.execute(
            select(JobORM)
            .where(JobORM.tenant_id == self._tenant_id)
            .order_by(JobORM.created_at.desc())
            .limit(limit)
        )
        return [self._to_model(row) for row in result.scalars().all()]

    async def update_status(
        self,
        job_id: str,
        status: JobStatus,
        error_message: str | None = None,
    ) -> None:
        result = await self._db.execute(
            select(JobORM).where(
                JobORM.id == job_id,
                JobORM.tenant_id == self._tenant_id,
            )
        )
        orm = result.scalar_one_or_none()
        if orm is None:
            return
        orm.status = status.value
        orm.updated_at = datetime.utcnow()
        if error_message is not None:
            orm.error_message = error_message
        if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            orm.completed_at = datetime.utcnow()
        await self._db.commit()

    async def update_progress(self, job_id: str, tables_total: int, tables_processed: int) -> None:
        result = await self._db.execute(
            select(JobORM).where(
                JobORM.id == job_id,
                JobORM.tenant_id == self._tenant_id,
            )
        )
        orm = result.scalar_one_or_none()
        if orm is None:
            return
        orm.tables_total = tables_total
        orm.tables_processed = tables_processed
        orm.updated_at = datetime.utcnow()
        await self._db.commit()

    async def update_source_config(
        self,
        job_id: str,
        source_config: dict,
        source_config_safe: dict,
    ) -> None:
        """Replace the stored connection config (credentials + safe view) for a job."""
        result = await self._db.execute(
            select(JobORM).where(
                JobORM.id == job_id,
                JobORM.tenant_id == self._tenant_id,
            )
        )
        orm = result.scalar_one_or_none()
        if orm is None:
            return
        orm.source_config = source_config
        orm.source_config_safe = source_config_safe
        orm.updated_at = datetime.utcnow()
        await self._db.commit()

    async def delete(self, job_id: str) -> bool:
        result = await self._db.execute(
            select(JobORM).where(
                JobORM.id == job_id,
                JobORM.tenant_id == self._tenant_id,
            )
        )
        orm = result.scalar_one_or_none()
        if orm is None:
            return False
        await self._db.delete(orm)
        await self._db.commit()
        return True

    @staticmethod
    def _to_model(orm: JobORM) -> Job:
        return Job(
            id=orm.id,
            status=JobStatus(orm.status),
            source_type=orm.source_type,
            source_config_safe=orm.source_config_safe or {},
            error_message=orm.error_message,
            tables_total=orm.tables_total,
            tables_processed=orm.tables_processed,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
            completed_at=orm.completed_at,
        )
