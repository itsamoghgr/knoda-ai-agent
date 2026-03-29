from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from storage.orm.charts import ChartORM, DashboardChartORM, DashboardORM, DatasetORM


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class DatasetRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def create(self, job_id: str, name: str, sql: str, description: str = "") -> DatasetORM:
        orm = DatasetORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            job_id=job_id,
            name=name,
            description=description,
            sql=sql,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def list(self, job_id: str | None = None) -> list[DatasetORM]:
        q = (
            select(DatasetORM)
            .where(DatasetORM.tenant_id == self._tenant_id)
            .order_by(DatasetORM.created_at.desc())
        )
        if job_id:
            q = q.where(DatasetORM.job_id == job_id)
        result = await self._db.execute(q)
        return list(result.scalars().all())

    async def get(self, dataset_id: str) -> DatasetORM | None:
        result = await self._db.execute(
            select(DatasetORM).where(
                DatasetORM.id == dataset_id,
                DatasetORM.tenant_id == self._tenant_id,
            )
        )
        return result.scalar_one_or_none()

    async def update(self, dataset_id: str, **fields) -> DatasetORM | None:
        orm = await self.get(dataset_id)
        if orm is None:
            return None
        for k, v in fields.items():
            setattr(orm, k, v)
        orm.updated_at = datetime.utcnow()
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def delete(self, dataset_id: str) -> bool:
        orm = await self.get(dataset_id)
        if orm is None:
            return False
        await self._db.delete(orm)
        await self._db.commit()
        return True


# ---------------------------------------------------------------------------
# Chart
# ---------------------------------------------------------------------------


class ChartRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def create(
        self,
        dataset_id: str,
        name: str,
        chart_type: str,
        config: dict,
        description: str = "",
    ) -> ChartORM:
        orm = ChartORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            dataset_id=dataset_id,
            name=name,
            description=description,
            chart_type=chart_type,
            config=config,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def list(self, dataset_id: str | None = None) -> list[ChartORM]:
        q = (
            select(ChartORM)
            .where(ChartORM.tenant_id == self._tenant_id)
            .order_by(ChartORM.created_at.desc())
        )
        if dataset_id:
            q = q.where(ChartORM.dataset_id == dataset_id)
        result = await self._db.execute(q)
        return list(result.scalars().all())

    async def get(self, chart_id: str) -> ChartORM | None:
        result = await self._db.execute(
            select(ChartORM).where(
                ChartORM.id == chart_id,
                ChartORM.tenant_id == self._tenant_id,
            )
        )
        return result.scalar_one_or_none()

    async def update(self, chart_id: str, **fields) -> ChartORM | None:
        orm = await self.get(chart_id)
        if orm is None:
            return None
        for k, v in fields.items():
            setattr(orm, k, v)
        orm.updated_at = datetime.utcnow()
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def delete(self, chart_id: str) -> bool:
        orm = await self.get(chart_id)
        if orm is None:
            return False
        await self._db.delete(orm)
        await self._db.commit()
        return True


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class DashboardRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    async def create(self, name: str, description: str = "") -> DashboardORM:
        orm = DashboardORM(
            id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            name=name,
            description=description,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def list(self) -> list[DashboardORM]:
        result = await self._db.execute(
            select(DashboardORM)
            .where(DashboardORM.tenant_id == self._tenant_id)
            .order_by(DashboardORM.created_at.desc())
        )
        return list(result.scalars().all())

    def _dashboard_similarity(self, query: str, candidate_name: str) -> float:
        """Token-set Jaccard similarity between a query string and a dashboard name."""
        _STOP = {
            "a", "an", "the", "for", "of", "and", "or", "to", "in", "on", "at",
            "by", "with", "new", "create", "build", "make", "show", "me", "us",
        }

        def tokenize(s: str) -> set[str]:
            return {w for w in s.lower().split() if w.isalpha() and w not in _STOP}

        q_tokens = tokenize(query)
        c_tokens = tokenize(candidate_name)
        if not q_tokens or not c_tokens:
            return 0.0
        return len(q_tokens & c_tokens) / len(q_tokens | c_tokens)

    async def find_similar(self, query: str, threshold: float = 0.30) -> list[dict]:
        """Return existing dashboards whose names are semantically similar to query.

        Uses token-set Jaccard similarity. Returns matches sorted by score descending.
        """
        dashboards = await self.list()
        results = []
        for d in dashboards:
            score = self._dashboard_similarity(query, d.name)
            if score >= threshold:
                results.append({
                    "id": d.id,
                    "name": d.name,
                    "description": d.description or "",
                    "similarity_score": round(score, 3),
                    "url": f"/dashboards/{d.id}",
                })
        results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return results

    async def get(self, dashboard_id: str) -> DashboardORM | None:
        result = await self._db.execute(
            select(DashboardORM).where(
                DashboardORM.id == dashboard_id,
                DashboardORM.tenant_id == self._tenant_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_with_charts(self, dashboard_id: str) -> DashboardORM | None:
        result = await self._db.execute(
            select(DashboardORM)
            .where(
                DashboardORM.id == dashboard_id,
                DashboardORM.tenant_id == self._tenant_id,
            )
            .options(
                selectinload(DashboardORM.dashboard_charts).selectinload(
                    DashboardChartORM.chart
                )
            )
        )
        return result.scalar_one_or_none()

    async def update(self, dashboard_id: str, **fields) -> DashboardORM | None:
        orm = await self.get(dashboard_id)
        if orm is None:
            return None
        for k, v in fields.items():
            setattr(orm, k, v)
        orm.updated_at = datetime.utcnow()
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def delete(self, dashboard_id: str) -> bool:
        orm = await self.get(dashboard_id)
        if orm is None:
            return False
        await self._db.delete(orm)
        await self._db.commit()
        return True

    async def add_chart(
        self,
        dashboard_id: str,
        chart_id: str,
        grid_x: int = 0,
        grid_y: int = 0,
        grid_w: int = 6,
        grid_h: int = 4,
    ) -> DashboardChartORM:
        orm = DashboardChartORM(
            id=str(uuid.uuid4()),
            dashboard_id=dashboard_id,
            chart_id=chart_id,
            grid_x=grid_x,
            grid_y=grid_y,
            grid_w=grid_w,
            grid_h=grid_h,
        )
        self._db.add(orm)
        await self._db.commit()
        await self._db.refresh(orm)
        return orm

    async def remove_chart(self, dashboard_id: str, chart_id: str) -> bool:
        result = await self._db.execute(
            select(DashboardChartORM).where(
                DashboardChartORM.dashboard_id == dashboard_id,
                DashboardChartORM.chart_id == chart_id,
            )
        )
        orm = result.scalar_one_or_none()
        if orm is None:
            return False
        await self._db.delete(orm)
        await self._db.commit()
        return True

    async def update_layout(
        self, dashboard_id: str, layout: list[dict]
    ) -> None:
        """Bulk-update grid positions for all charts in a dashboard."""
        result = await self._db.execute(
            select(DashboardChartORM).where(
                DashboardChartORM.dashboard_id == dashboard_id
            )
        )
        existing = {dc.chart_id: dc for dc in result.scalars().all()}
        for item in layout:
            cid = item.get("chart_id")
            if cid in existing:
                dc = existing[cid]
                dc.grid_x = item.get("grid_x", dc.grid_x)
                dc.grid_y = item.get("grid_y", dc.grid_y)
                dc.grid_w = item.get("grid_w", dc.grid_w)
                dc.grid_h = item.get("grid_h", dc.grid_h)
        await self._db.commit()
