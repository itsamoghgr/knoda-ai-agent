from models.connection import SourceConfig


def build_attach_sql(config: SourceConfig, alias: str) -> str:
    """S3/Parquet sources are queried directly via httpfs — no ATTACH needed."""
    return ""


def install_extension_sql() -> list[str]:
    return ["INSTALL httpfs", "LOAD httpfs"]


def build_s3_config_sql(config: SourceConfig) -> list[str]:
    """Configure S3 credentials for the DuckDB session."""
    statements = []
    if config.aws_access_key_id and config.aws_secret_access_key:
        key_id = config.aws_access_key_id.get_secret_value().replace("'", "''")
        secret = config.aws_secret_access_key.get_secret_value().replace("'", "''")
        statements.append(f"SET s3_access_key_id='{key_id}'")
        statements.append(f"SET s3_secret_access_key='{secret}'")
    if config.s3_region:
        region = config.s3_region.replace("'", "''")
        statements.append(f"SET s3_region='{region}'")
    return statements
