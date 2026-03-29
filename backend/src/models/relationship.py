from enum import StrEnum

from pydantic import BaseModel, Field


class RelationshipSource(StrEnum):
    EXPLICIT = "explicit"  # from duckdb_constraints() / information_schema FK
    INFERRED = "inferred"  # detected via name similarity + value containment


class Relationship(BaseModel):
    """A foreign-key relationship between two columns, detected or inferred."""

    from_database: str
    from_schema: str
    from_table: str
    from_column: str

    to_database: str
    to_schema: str
    to_table: str
    to_column: str

    confidence: float = Field(ge=0.0, le=1.0)
    source: RelationshipSource

    @property
    def from_fqn(self) -> str:
        return f"{self.from_database}.{self.from_schema}.{self.from_table}.{self.from_column}"

    @property
    def to_fqn(self) -> str:
        return f"{self.to_database}.{self.to_schema}.{self.to_table}.{self.to_column}"
