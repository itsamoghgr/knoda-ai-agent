from urllib.parse import quote

from models.connection import SourceConfig


def build_attach_sql(config: SourceConfig, alias: str) -> str:
    """Build DuckDB ATTACH SQL for a MySQL source in READ_ONLY mode."""
    password = config.password.get_secret_value() if config.password else ""
    # URL-encode username and password so special characters (@ # $ / % etc.) don't break the URI
    username = quote(config.username or "", safe="")
    password = quote(password, safe="")
    dsn = f"mysql://{username}:{password}@{config.host}:{config.port or 3306}/{config.database}"
    return f"ATTACH '{dsn}' AS {alias} (TYPE mysql, READ_ONLY)"


def install_extension_sql() -> list[str]:
    return ["INSTALL mysql", "LOAD mysql"]
