from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    settings.database_url,
    pool_size=4,        # persistent connections through Supavisor transaction pooler
    max_overflow=2,     # burst headroom; total max = 6
    pool_pre_ping=True,
    echo=False,
    # Required for PgBouncer/Supavisor transaction mode — prepared statements are
    # not supported across connections in transaction mode.
    connect_args={"statement_cache_size": 0},
)

AsyncSessionFactory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionFactory() as session:
        yield session
