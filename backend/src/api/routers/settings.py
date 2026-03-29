"""Settings router — manage multi-provider LLM configuration from the UI."""

import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentUser, get_current_user
from storage.database import get_db
from storage.repositories.settings_repo import SUPPORTED_PROVIDERS, SettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])


# ─── Response / request models ────────────────────────────────────────────────

class ProviderConfig(BaseModel):
    model: str | None = None
    api_key_set: bool = False


class AppSettingsResponse(BaseModel):
    active_provider: str | None
    providers: dict[str, ProviderConfig]


class SaveProviderRequest(BaseModel):
    """Save (or update) configuration for one provider."""
    provider: str
    model: str
    api_key: str | None = None


class ActivateProviderRequest(BaseModel):
    """Switch the active provider without touching its saved config."""
    provider: str


class TestLlmResponse(BaseModel):
    ok: bool
    model: str | None = None
    latency_ms: int | None = None
    error: str | None = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _build_response(repo: SettingsRepository) -> AppSettingsResponse:
    active = await repo.get_active_provider()
    all_configs = await repo.get_all_provider_configs()
    return AppSettingsResponse(
        active_provider=active,
        providers={p: ProviderConfig(**cfg) for p, cfg in all_configs.items()},
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=AppSettingsResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> AppSettingsResponse:
    """Return active provider and config status for all supported providers."""
    return await _build_response(SettingsRepository(db, current_user.id))


@router.patch("", response_model=AppSettingsResponse)
async def save_provider(
    request: SaveProviderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> AppSettingsResponse:
    """Save model + API key for a specific provider. Does not change the active provider."""
    if request.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported provider '{request.provider}'. Must be one of: {list(SUPPORTED_PROVIDERS)}",
        )
    repo = SettingsRepository(db, current_user.id)
    await repo.save_provider_config(
        provider=request.provider,
        model=request.model,
        api_key=request.api_key,
    )

    # Auto-activate if nothing is currently active
    active = await repo.get_active_provider()
    if not active:
        await repo.set_active_provider(request.provider)

    # If the user updated config for the currently active provider, abort
    # any in-flight streams that still hold the old API key/model in memory.
    if active == request.provider or not active:
        from api.routers.agent import abort_tenant_streams
        abort_tenant_streams(str(current_user.id))

    return await _build_response(repo)


@router.patch("/activate", response_model=AppSettingsResponse)
async def activate_provider(
    request: ActivateProviderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> AppSettingsResponse:
    """Switch the active LLM provider. The provider must have a saved config."""
    if request.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported provider '{request.provider}'.",
        )
    repo = SettingsRepository(db, current_user.id)
    cfg = await repo.get_provider_config(request.provider)
    if not cfg or not cfg.get("model"):
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{request.provider}' has no saved configuration. Save it first.",
        )
    await repo.set_active_provider(request.provider)
    from api.routers.agent import abort_tenant_streams
    abort_tenant_streams(str(current_user.id))
    return await _build_response(repo)


@router.post("/test-llm", response_model=TestLlmResponse)
async def test_llm_connection(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> TestLlmResponse:
    """Send a minimal test prompt to the active LLM and measure latency."""
    repo = SettingsRepository(db, current_user.id)
    provider, api_key, model = await repo.get_llm_config()

    if not provider or not model:
        return TestLlmResponse(ok=False, error="No active LLM provider configured.")
    if not api_key and provider != "ollama":
        return TestLlmResponse(ok=False, error="No API key saved for the active provider.")

    try:
        start = time.monotonic()
        llm = _build_llm(provider, api_key or "", model)
        from langchain_core.messages import HumanMessage
        response = await llm.ainvoke([HumanMessage(content="Reply with exactly: ok")])
        latency_ms = int((time.monotonic() - start) * 1000)
        _ = response.content
        return TestLlmResponse(ok=True, model=model, latency_ms=latency_ms)
    except Exception as exc:
        logger.warning("LLM test connection failed: %s", exc)
        return TestLlmResponse(ok=False, error=str(exc))


def _build_llm(provider: str, api_key: str, model: str):  # type: ignore[return]
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=model, api_key=api_key, max_tokens=16)
    elif provider == "ollama":
        from langchain_community.chat_models import ChatOllama  # type: ignore[import]
        return ChatOllama(model=model)
    elif provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(model=model, api_key=api_key, temperature=0, max_tokens=16)
    elif provider == "featherless":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=api_key, base_url="https://api.featherless.ai/v1", max_tokens=16)
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=api_key, max_tokens=16)


# ─── Embedding config ──────────────────────────────────────────────────────────

class EmbeddingSettingsResponse(BaseModel):
    api_key_set: bool
    model: str = "text-embedding-3-small"


class SaveEmbeddingRequest(BaseModel):
    api_key: str


@router.get("/embedding", response_model=EmbeddingSettingsResponse)
async def get_embedding_settings(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EmbeddingSettingsResponse:
    """Return whether an embedding API key is configured."""
    repo = SettingsRepository(db, current_user.id)
    api_key = await repo.get_embedding_api_key()
    return EmbeddingSettingsResponse(api_key_set=bool(api_key))


@router.patch("/embedding", response_model=EmbeddingSettingsResponse)
async def save_embedding_settings(
    request: SaveEmbeddingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> EmbeddingSettingsResponse:
    """Save the OpenAI API key used for generating table embeddings."""
    if not request.api_key.strip():
        raise HTTPException(status_code=422, detail="api_key cannot be empty")
    repo = SettingsRepository(db, current_user.id)
    await repo.save_embedding_api_key(request.api_key.strip())
    return EmbeddingSettingsResponse(api_key_set=True)


# ─── Business context ───────────────────────────────────────────────────────────

class BusinessContextFields(BaseModel):
    """Structured business context with one field per guided question."""
    company_description: str = ""
    business_model: str = ""
    fiscal_year_start: str = ""
    currency: str = ""
    revenue_definition: str = ""
    churn_definition: str = ""
    exclusions: str = ""
    additional_context: str = ""


class BusinessContextResponse(BusinessContextFields):
    pass


class SaveBusinessContextRequest(BusinessContextFields):
    pass


@router.get("/business-context", response_model=BusinessContextResponse)
async def get_business_context(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> BusinessContextResponse:
    """Return the saved business context fields (all empty strings when not set)."""
    repo = SettingsRepository(db, current_user.id)
    fields = await repo.get_business_context()
    return BusinessContextResponse(**fields)


@router.patch("/business-context", response_model=BusinessContextResponse)
async def save_business_context(
    request: SaveBusinessContextRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> BusinessContextResponse:
    """Save the structured business context fields."""
    repo = SettingsRepository(db, current_user.id)
    await repo.save_business_context(request.model_dump())
    return BusinessContextResponse(**request.model_dump())
