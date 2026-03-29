import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from storage.database import Base


class TableMetaORM(Base):
    __tablename__ = "discovered_tables"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_name: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_name: Mapped[str] = mapped_column(String(255), nullable=False)
    table_name: Mapped[str] = mapped_column(String(255), nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, default=0)
    row_estimate: Mapped[int] = mapped_column(Integer, default=0)

    columns: Mapped[list["ColumnMetaORM"]] = relationship(
        "ColumnMetaORM", back_populates="table", cascade="all, delete-orphan"
    )


class ColumnMetaORM(Base):
    __tablename__ = "discovered_columns"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    table_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("discovered_tables.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    column_type: Mapped[str] = mapped_column(String(128), nullable=False)
    is_nullable: Mapped[bool] = mapped_column(Boolean, default=True)
    column_default: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordinal_position: Mapped[int] = mapped_column(Integer, default=0)
    is_primary_key: Mapped[bool] = mapped_column(Boolean, default=False)
    foreign_key_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)

    table: Mapped["TableMetaORM"] = relationship("TableMetaORM", back_populates="columns")
