from enum import StrEnum

from pydantic import BaseModel


class ConstraintType(StrEnum):
    PRIMARY_KEY = "PRIMARY KEY"
    FOREIGN_KEY = "FOREIGN KEY"
    UNIQUE = "UNIQUE"
    CHECK = "CHECK"
    NOT_NULL = "NOT NULL"


class ConstraintMeta(BaseModel):
    constraint_type: ConstraintType
    column_names: list[str]
    # Foreign key target (only when constraint_type == FOREIGN_KEY)
    fk_table: str | None = None
    fk_column_names: list[str] = []


class ColumnMeta(BaseModel):
    column_name: str
    column_type: str
    is_nullable: bool = True
    column_default: str | None = None
    ordinal_position: int = 0
    is_primary_key: bool = False
    foreign_key_ref: str | None = None  # "schema.table.column" if FK detected


class TableMeta(BaseModel):
    database_name: str
    schema_name: str
    table_name: str
    column_count: int = 0
    row_estimate: int = 0
    columns: list[ColumnMeta] = []
    constraints: list[ConstraintMeta] = []

    @property
    def fully_qualified_name(self) -> str:
        return f"{self.database_name}.{self.schema_name}.{self.table_name}"
