from models.connection import SourceConfig


def build_attach_sql(config: SourceConfig, alias: str) -> str:
    """Build DuckDB ATTACH SQL for a DuckDB file source in READ_ONLY mode."""
    return f"ATTACH '{config.file_path}' AS {alias} (READ_ONLY)"


def install_extension_sql() -> list[str]:
    return []
