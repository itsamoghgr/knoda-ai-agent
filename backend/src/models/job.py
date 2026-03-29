import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    PENDING = "pending"
    BOOTSTRAPPING = "bootstrapping"  # Fast catalog schema discovery (no LLM, no table scans)
    RUNNING = "running"              # Agent session — reasoning, querying, saving models
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: JobStatus = JobStatus.PENDING
    source_type: str
    source_config_safe: dict = Field(description="Config with secrets redacted")
    error_message: str | None = None
    tables_total: int = 0
    tables_processed: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None

    @property
    def progress_pct(self) -> int:
        if self.tables_total == 0:
            return 0
        return int((self.tables_processed / self.tables_total) * 100)


class ProgressEvent(BaseModel):
    """SSE event emitted by the agent to report live progress."""

    job_id: str
    phase: str
    message: str
    table_name: str | None = None
    progress_pct: int = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
