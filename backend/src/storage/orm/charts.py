import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from storage.database import Base


class DatasetORM(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    sql: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    charts: Mapped[list["ChartORM"]] = relationship(
        "ChartORM", back_populates="dataset", cascade="all, delete-orphan"
    )


class ChartORM(Base):
    __tablename__ = "charts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    dataset_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    chart_type: Mapped[str] = mapped_column(
        sa.String(50), nullable=False
    )  # bar|line|area|pie|donut|kpi|table
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dataset: Mapped["DatasetORM"] = relationship("DatasetORM", back_populates="charts")
    dashboard_charts: Mapped[list["DashboardChartORM"]] = relationship(
        "DashboardChartORM", back_populates="chart", cascade="all, delete-orphan"
    )


class DashboardORM(Base):
    __tablename__ = "dashboards"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(sa.Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    dashboard_charts: Mapped[list["DashboardChartORM"]] = relationship(
        "DashboardChartORM", back_populates="dashboard", cascade="all, delete-orphan"
    )


class DashboardChartORM(Base):
    __tablename__ = "dashboard_charts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    dashboard_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("dashboards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chart_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        sa.ForeignKey("charts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    grid_x: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    grid_y: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    grid_w: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=6)
    grid_h: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=4)

    dashboard: Mapped["DashboardORM"] = relationship(
        "DashboardORM", back_populates="dashboard_charts"
    )
    chart: Mapped["ChartORM"] = relationship(
        "ChartORM", back_populates="dashboard_charts"
    )

    __table_args__ = (
        sa.UniqueConstraint("dashboard_id", "chart_id", name="uq_dashboard_chart"),
    )
