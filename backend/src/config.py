from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # PostgreSQL operational store (pooled connection for runtime)
    database_url: str = Field(
        description="Async SQLAlchemy URL for the operational PostgreSQL database",
    )

    # Optional direct connection URL for Alembic migrations.
    # Required when DATABASE_URL points to a PgBouncer pooler (transaction mode),
    # which does not support DDL. Falls back to database_url when not set.
    alembic_database_url: str | None = Field(
        default=None,
        description="Direct (non-pooled) PostgreSQL URL used only by Alembic migrations",
    )

    # Supabase project URL.
    # Copy from: Supabase dashboard → Project Settings → API → Project URL
    supabase_url: str = Field(
        default="",
        description="Supabase project URL (e.g. https://xyz.supabase.co)",
    )

    # Supabase service role key — used by the backend to verify user tokens via
    # supabase.auth.get_user(). Never expose this to the frontend.
    # Copy from: Supabase dashboard → Project Settings → API → service_role key
    supabase_service_role_key: str = Field(
        default="",
        description="Supabase service role key for backend auth verification",
    )

    # LLM configuration
    llm_provider: str = Field(
        default="openai",
        description="LLM provider: openai | anthropic | ollama | groq (UI settings override)",
    )
    llm_api_key: str = Field(default="", description="API key for the chosen LLM provider")
    llm_model: str = Field(default="gpt-4o", description="Model name to use for semantic analysis")

    # Discovery safety limits
    max_rows_per_query: int = Field(
        default=1000, description="Maximum rows returned per query executed against source DBs"
    )
    query_timeout_seconds: int = Field(
        default=30, description="Seconds before a source query is killed"
    )
    max_sample_rows: int = Field(default=10, description="Number of sample rows fetched per table")
    max_concurrent_table_tasks: int = Field(
        default=10, description="Max parallel table discovery tasks in Phase 1"
    )

    # Redis — snapshot store + presentation session store + short-term memory checkpointer
    redis_url: str = Field(
        default="redis://localhost:6379",
        description="Redis connection URL (rediss://... for TLS in production)",
    )

    # v2: OpenAI TTS settings (for live presentation / meeting narration)
    tts_model: str = Field(
        default="tts-1",
        description="OpenAI TTS model: 'tts-1' (faster) or 'tts-1-hd' (higher quality)",
    )
    tts_voice: str = Field(
        default="alloy",
        description="OpenAI TTS voice: alloy | echo | fable | onyx | nova | shimmer",
    )

    # Meeting bot (Google Meet via Recall.ai)
    recall_api_key: str = Field(
        default="",
        description="Recall.ai API key for creating meeting bots",
    )
    recall_webhook_secret: str = Field(
        default="",
        description="HMAC secret used to verify Recall.ai webhook payloads",
    )
    # Sync PostgreSQL URL for APScheduler SQLAlchemyJobStore.
    # Falls back to deriving from database_url when not set (replaces asyncpg with psycopg2).
    apscheduler_database_url: str | None = Field(
        default=None,
        description="Sync SQLAlchemy URL for APScheduler job store (psycopg2 driver)",
    )
    # Long-lived Supabase service token the meeting bot uses to call /present/* endpoints.
    # Create a dedicated Supabase service account and paste its JWT here.
    bot_auth_token: str = Field(
        default="",
        description="Bearer token the meeting bot uses to call internal /present/* endpoints",
    )
    frontend_base_url: str = Field(
        default="http://localhost:3000",
        description="Base URL of the Next.js frontend — used by the bot to open dashboard pages",
    )
    api_public_url: str | None = Field(
        default=None,
        description=(
            "Public base URL of this API server — used to build Recall.ai webhook URLs. "
            "Defaults to frontend_base_url when not set (for environments sharing a hostname)."
        ),
    )
    meet_bot_name: str = Field(
        default="Knoda AI",
        description="Display name the bot uses when joining Google Meet",
    )

    # API server
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:5173"],
        description="Allowed CORS origins for the frontend",
    )


settings = Settings()
