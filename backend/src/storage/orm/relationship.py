import uuid

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from storage.database import Base


class RelationshipORM(Base):
    __tablename__ = "relationships"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_database: Mapped[str] = mapped_column(String(255), nullable=False)
    from_schema: Mapped[str] = mapped_column(String(255), nullable=False)
    from_table: Mapped[str] = mapped_column(String(255), nullable=False)
    from_column: Mapped[str] = mapped_column(String(255), nullable=False)
    to_database: Mapped[str] = mapped_column(String(255), nullable=False)
    to_schema: Mapped[str] = mapped_column(String(255), nullable=False)
    to_table: Mapped[str] = mapped_column(String(255), nullable=False)
    to_column: Mapped[str] = mapped_column(String(255), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # explicit | inferred
