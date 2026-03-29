from enum import StrEnum

from pydantic import BaseModel


class EntityType(StrEnum):
    PRIMARY = "primary"
    FOREIGN = "foreign"


class DimensionType(StrEnum):
    CATEGORICAL = "categorical"
    TIME = "time"


class MeasureAgg(StrEnum):
    COUNT = "count"
    SUM = "sum"
    AVG = "avg"
    MIN = "min"
    MAX = "max"
    COUNT_DISTINCT = "count_distinct"


class Entity(BaseModel):
    name: str
    entity_type: EntityType
    column_name: str
    description: str = ""


class Dimension(BaseModel):
    name: str
    dim_type: DimensionType
    column_name: str
    description: str = ""
    # For time dimensions
    time_granularity: str | None = None  # day | week | month | year


class Measure(BaseModel):
    name: str
    agg: MeasureAgg
    expr: str  # column name or SQL expression
    description: str = ""


class UncertainColumn(BaseModel):
    """Column that Phase 2 LLM could not confidently classify."""

    table_fqn: str
    column_name: str
    column_type: str
    reason: str  # why the LLM was uncertain


class SemanticModel(BaseModel):
    """Semantic layer for a single table — output of Phase 2 LLM analysis."""

    database_name: str
    schema_name: str
    table_name: str
    description: str = ""
    table_type: str = "unknown"  # fact | dimension | bridge | unknown
    grain: str = ""  # column name or description of the grain
    entities: list[Entity] = []
    dimensions: list[Dimension] = []
    measures: list[Measure] = []

    @property
    def fully_qualified_name(self) -> str:
        return f"{self.database_name}.{self.schema_name}.{self.table_name}"
