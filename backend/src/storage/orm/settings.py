from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from storage.database import Base


class AppSettingORM(Base):
    __tablename__ = "app_settings"

    # Composite primary key: one row per (tenant, key)
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
