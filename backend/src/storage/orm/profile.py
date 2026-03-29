import uuid

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from storage.database import Base


class ProfileResultORM(Base):
    __tablename__ = "profile_results"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    database_name: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_name: Mapped[str] = mapped_column(String(255), nullable=False)
    table_name: Mapped[str] = mapped_column(String(255), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    sample_rows: Mapped[list] = mapped_column(JSONB, default=list)

    column_profiles: Mapped[list["ColumnProfileORM"]] = relationship(
        "ColumnProfileORM", back_populates="profile_result", cascade="all, delete-orphan"
    )


class ColumnProfileORM(Base):
    __tablename__ = "column_profiles"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    profile_result_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("profile_results.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    column_name: Mapped[str] = mapped_column(String(255), nullable=False)
    column_type: Mapped[str] = mapped_column(String(128), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    null_count: Mapped[int] = mapped_column(Integer, default=0)
    null_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    approx_unique: Mapped[int] = mapped_column(Integer, default=0)
    min_val: Mapped[str | None] = mapped_column(String(512), nullable=True)
    max_val: Mapped[str | None] = mapped_column(String(512), nullable=True)
    avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    std: Mapped[float | None] = mapped_column(Float, nullable=True)
    q25: Mapped[float | None] = mapped_column(Float, nullable=True)
    q50: Mapped[float | None] = mapped_column(Float, nullable=True)
    q75: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_values: Mapped[list] = mapped_column(JSONB, default=list)

    profile_result: Mapped["ProfileResultORM"] = relationship(
        "ProfileResultORM", back_populates="column_profiles"
    )
