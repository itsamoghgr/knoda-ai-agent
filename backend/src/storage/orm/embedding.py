import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from storage.database import Base

try:
    from pgvector.sqlalchemy import Vector
    _VECTOR_TYPE = Vector(1536)
except ImportError:  # pgvector not installed — column becomes Text fallback
    _VECTOR_TYPE = sa.Text()


class TableEmbeddingORM(Base):
    __tablename__ = "table_embeddings"

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
    schema_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    table_name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    text_content: Mapped[str] = mapped_column(sa.Text, nullable=False)
    model: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=False), default=datetime.utcnow, nullable=False
    )

    # Vector column added separately to keep the ORM loadable even without pgvector
    __table_args__ = (
        sa.UniqueConstraint("job_id", "schema_name", "table_name", name="uq_table_embedding"),
    )
