from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, SecretStr


class SourceType(StrEnum):
    POSTGRES = "postgres"
    MYSQL = "mysql"
    DUCKDB = "duckdb"
    S3_PARQUET = "s3_parquet"
    TRINO = "trino"


class SourceConfig(BaseModel):
    """Connection configuration for a source database.

    Credentials are stored as SecretStr so they are never accidentally
    logged or serialized in plain text.
    """

    source_type: SourceType

    # Applies to postgres, mysql, trino
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: SecretStr | None = None

    # Applies to duckdb
    file_path: str | None = None

    # Applies to s3_parquet
    s3_bucket: str | None = None
    s3_prefix: str | None = None
    s3_region: str | None = None
    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None

    # Optional: restrict discovery to specific schemas.
    # include_schemas takes priority — if set, only those schemas are scanned.
    # exclude_schemas supplements the built-in system-schema exclusion list.
    include_schemas: list[str] = Field(default_factory=list)
    exclude_schemas: list[str] = Field(default_factory=list)

    def to_safe_dict(self) -> dict[str, Any]:
        """Return config dict with secrets redacted — safe for logging and storage."""
        data = self.model_dump(exclude={"password", "aws_access_key_id", "aws_secret_access_key"})
        if self.password is not None:
            data["password"] = "***"
        if self.aws_access_key_id is not None:
            data["aws_access_key_id"] = "***"
        if self.aws_secret_access_key is not None:
            data["aws_secret_access_key"] = "***"
        return data

    def to_storage_dict(self) -> dict[str, Any]:
        """Return config with actual secret values exposed — for encrypted DB storage only.

        Pydantic v2 serializes SecretStr as "**********" with model_dump(mode="json"),
        so we override each secret field with the real value after dumping.
        """
        data = self.model_dump(mode="json")
        if self.password is not None:
            data["password"] = self.password.get_secret_value()
        if self.aws_access_key_id is not None:
            data["aws_access_key_id"] = self.aws_access_key_id.get_secret_value()
        if self.aws_secret_access_key is not None:
            data["aws_secret_access_key"] = self.aws_secret_access_key.get_secret_value()
        return data
