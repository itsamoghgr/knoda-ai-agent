"""Agent state for the agentic discovery pipeline."""

from pydantic import BaseModel, Field

from models.job import ProgressEvent
from models.relationship import Relationship
from models.schema import TableMeta
from models.semantic import SemanticModel


class AgentState(BaseModel):
    """State accumulated throughout the discovery run."""

    job_id: str

    # Bootstrap output — full schema as structured text fed to the agent
    schema_context: str = ""

    # Bootstrap output — raw TableMeta list for persisting to PostgreSQL
    tables: list[TableMeta] = Field(default_factory=list)
    tables_total: int = 0

    # Agent outputs — accumulated during the agent loop
    semantic_models: list[SemanticModel] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    tables_saved: int = 0

    # Token usage — accumulated across all LLM calls during discovery
    input_tokens: int = 0
    output_tokens: int = 0

    # Control flags
    done: bool = False
    error: str | None = None

    # Buffered events (used when no live on_progress callback is available)
    progress_events: list[ProgressEvent] = Field(default_factory=list)

    class Config:
        arbitrary_types_allowed = True
