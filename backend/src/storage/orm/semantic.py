import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from storage.database import Base


class SemanticModelORM(Base):
    __tablename__ = "semantic_models"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_name: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_name: Mapped[str] = mapped_column(String(255), nullable=False)
    table_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    table_type: Mapped[str] = mapped_column(String(32), default="unknown")
    grain: Mapped[str] = mapped_column(Text, default="")

    entities: Mapped[list["EntityORM"]] = relationship(
        "EntityORM", back_populates="semantic_model", cascade="all, delete-orphan"
    )
    dimensions: Mapped[list["DimensionORM"]] = relationship(
        "DimensionORM", back_populates="semantic_model", cascade="all, delete-orphan"
    )
    measures: Mapped[list["MeasureORM"]] = relationship(
        "MeasureORM", back_populates="semantic_model", cascade="all, delete-orphan"
    )


class EntityORM(Base):
    __tablename__ = "semantic_entities"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    model_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("semantic_models.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)  # primary | foreign
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    semantic_model: Mapped["SemanticModelORM"] = relationship(
        "SemanticModelORM", back_populates="entities"
    )


class DimensionORM(Base):
    __tablename__ = "semantic_dimensions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    model_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("semantic_models.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    dim_type: Mapped[str] = mapped_column(String(32), nullable=False)  # categorical | time
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    time_granularity: Mapped[str | None] = mapped_column(String(32), nullable=True)

    semantic_model: Mapped["SemanticModelORM"] = relationship(
        "SemanticModelORM", back_populates="dimensions"
    )


class MeasureORM(Base):
    __tablename__ = "semantic_measures"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    model_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("semantic_models.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    agg: Mapped[str] = mapped_column(String(32), nullable=False)  # count|sum|avg|min|max
    expr: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

    semantic_model: Mapped["SemanticModelORM"] = relationship(
        "SemanticModelORM", back_populates="measures"
    )


class SemanticSnapshotORM(Base):
    """Full rendered dbt MetricFlow YAML — stored for download."""

    __tablename__ = "semantic_snapshots"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    yaml_content: Mapped[str] = mapped_column(Text, nullable=False)
