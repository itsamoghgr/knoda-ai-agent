import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from config import settings
from storage.database import Base
from storage.orm import job, schema, profile, relationship, semantic, embedding, charts, token_usage  # noqa: F401
from storage.orm import settings as _orm_settings  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Prefer ALEMBIC_DATABASE_URL (direct connection) when set — required when
# DATABASE_URL points to a PgBouncer pooler that doesn't support DDL.
_migration_url = settings.alembic_database_url or settings.database_url
# configparser treats % as an interpolation character, so escape it before
# passing the URL (e.g. %24 → %%24). SQLAlchemy decodes %% → % at runtime.
config.set_main_option("sqlalchemy.url", _migration_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        # Supavisor/PgBouncer transaction mode does not support prepared statements.
        connect_args={"statement_cache_size": 0},
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
