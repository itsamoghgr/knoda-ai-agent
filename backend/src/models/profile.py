from pydantic import BaseModel


class ColumnProfile(BaseModel):
    """Statistical profile for a single column — output of DuckDB SUMMARIZE."""

    column_name: str
    column_type: str
    row_count: int = 0
    null_count: int = 0
    null_percentage: float = 0.0
    approx_unique: int = 0

    # Numeric stats (None for non-numeric columns)
    min_val: str | None = None
    max_val: str | None = None
    avg: float | None = None
    std: float | None = None
    q25: float | None = None
    q50: float | None = None
    q75: float | None = None

    # Sample distinct values (up to 10, for categorical detection)
    sample_values: list[str] = []


class ProfileResult(BaseModel):
    """Full profile of a table — one ColumnProfile per column."""

    database_name: str
    schema_name: str
    table_name: str
    row_count: int = 0
    column_profiles: list[ColumnProfile] = []
    sample_rows: list[dict] = []  # raw sample rows from sample_table()

    @property
    def fully_qualified_name(self) -> str:
        return f"{self.database_name}.{self.schema_name}.{self.table_name}"
