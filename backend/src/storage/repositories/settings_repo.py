"""Settings repository — per-tenant, per-provider LLM config storage.

Storage layout in app_settings (key-value, scoped by tenant_id):
  llm_active_provider          → "openai" | "anthropic" | "ollama" | "groq"
  llm_config_openai            → JSON {"model": "gpt-4o", "api_key_vault_id": "<uuid>"}
  llm_config_anthropic         → JSON {"model": "claude-opus-4-5", "api_key_vault_id": "<uuid>"}
  llm_config_ollama            → JSON {"model": "llama3", "api_key_vault_id": null}
  llm_config_groq              → JSON {"model": "llama-3.3-70b-versatile", "api_key_vault_id": "<uuid>"}
  llm_config_featherless       → JSON {"model": "Qwen/Qwen2.5-72B-Instruct", "api_key_vault_id": "<uuid>"}

API keys are never stored in plaintext — they are stored encrypted in Supabase Vault.
The app_settings row stores only the Vault secret UUID (api_key_vault_id).

Legacy keys (read-only fallback, written by older versions):
  llm_provider / llm_api_key / llm_model
"""

import json
import logging
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from storage.orm.settings import AppSettingORM

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = ("openai", "anthropic", "ollama", "groq", "featherless")

_BUSINESS_CONTEXT_LABELS: dict[str, str] = {
    "company_description": "Company overview",
    "business_model": "Business model",
    "fiscal_year_start": "Fiscal year start",
    "currency": "Reporting currency",
    "revenue_definition": "Revenue definition",
    "churn_definition": "Churned customer definition",
    "exclusions": "Standard data exclusions",
    "additional_context": "Additional context",
}


def format_business_context_for_agent(fields: dict) -> str | None:
    """Convert a business-context dict into a human-readable block for the agent."""
    lines = []
    for key, label in _BUSINESS_CONTEXT_LABELS.items():
        value = (fields.get(key) or "").strip()
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines) if lines else None


_KEY_ACTIVE = "llm_active_provider"
_LEGACY_PROVIDER = "llm_provider"
_LEGACY_API_KEY = "llm_api_key"
_LEGACY_MODEL = "llm_model"


def _config_key(provider: str) -> str:
    return f"llm_config_{provider}"


class SettingsRepository:
    def __init__(self, db: AsyncSession, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    # ── Low-level helpers ──────────────────────────────────────────────────────

    async def _get(self, key: str) -> str | None:
        result = await self._db.execute(
            select(AppSettingORM).where(
                AppSettingORM.tenant_id == self._tenant_id,
                AppSettingORM.key == key,
            )
        )
        row = result.scalar_one_or_none()
        return row.value if row else None

    async def _set(self, key: str, value: str) -> None:
        result = await self._db.execute(
            select(AppSettingORM).where(
                AppSettingORM.tenant_id == self._tenant_id,
                AppSettingORM.key == key,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = value
            row.updated_at = datetime.utcnow()
        else:
            self._db.add(
                AppSettingORM(
                    tenant_id=self._tenant_id,
                    key=key,
                    value=value,
                    updated_at=datetime.utcnow(),
                )
            )
        await self._db.commit()

    # ── Supabase Vault helpers ─────────────────────────────────────────────────

    async def _vault_store(
        self, secret_name: str, api_key: str, existing_vault_id: str | None
    ) -> str:
        """Store an API key in Supabase Vault. Returns the vault UUID."""
        if existing_vault_id:
            await self._db.execute(
                text("SELECT vault.update_secret(cast(:id as uuid), :secret)"),
                {"id": existing_vault_id, "secret": api_key},
            )
            await self._db.commit()
            return existing_vault_id
        else:
            result = await self._db.execute(
                text("SELECT vault.create_secret(:secret, :name)"),
                {"secret": api_key, "name": secret_name},
            )
            vault_id = result.scalar()
            await self._db.commit()
            return str(vault_id)

    async def _vault_read(self, vault_id: str) -> str | None:
        """Decrypt and return an API key from Supabase Vault."""
        if not vault_id:
            return None
        result = await self._db.execute(
            text(
                "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = cast(:id as uuid)"
            ),
            {"id": vault_id},
        )
        return result.scalar()

    # ── Provider config ────────────────────────────────────────────────────────

    async def get_active_provider(self) -> str | None:
        prov = await self._get(_KEY_ACTIVE)
        if prov:
            return prov
        return await self._get(_LEGACY_PROVIDER)

    async def set_active_provider(self, provider: str) -> None:
        await self._set(_KEY_ACTIVE, provider)

    async def _get_raw_config(self, provider: str) -> dict | None:
        """Return raw config dict (with api_key_vault_id, not the decrypted key)."""
        raw = await self._get(_config_key(provider))
        if raw:
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                return None
        return None

    async def get_provider_config(self, provider: str) -> dict | None:
        """Return config dict {"model": ..., "api_key": ...} with decrypted key, or None."""
        cfg = await self._get_raw_config(provider)
        if not cfg:
            return None
        vault_id = cfg.get("api_key_vault_id")
        api_key = await self._vault_read(vault_id) if vault_id else ""
        return {"model": cfg.get("model"), "api_key": api_key or ""}

    async def save_provider_config(self, provider: str, model: str, api_key: str | None) -> None:
        """Upsert config for a specific provider. api_key=None keeps the existing key."""
        existing_raw = await self._get_raw_config(provider) or {}
        existing_vault_id: str | None = existing_raw.get("api_key_vault_id")

        if api_key is not None and api_key.strip():
            vault_id = await self._vault_store(
                secret_name=f"{self._tenant_id}_llm_{provider}",
                api_key=api_key.strip(),
                existing_vault_id=existing_vault_id,
            )
        else:
            vault_id = existing_vault_id  # preserve existing

        config = {"model": model, "api_key_vault_id": vault_id}
        await self._set(_config_key(provider), json.dumps(config))

    async def get_all_provider_configs(self) -> dict[str, dict]:
        """Return config for all supported providers — never includes raw api_key."""
        configs: dict[str, dict] = {}
        for provider in SUPPORTED_PROVIDERS:
            raw = await self._get_raw_config(provider)
            if raw:
                vault_id = raw.get("api_key_vault_id") or ""
                configs[provider] = {
                    "model": raw.get("model") or None,
                    "api_key_set": bool(vault_id),
                }
            else:
                configs[provider] = {"model": None, "api_key_set": False}
        return configs

    # ── Compat shim (used by agents, chat, discovery) ─────────────────────────

    async def get_llm_config(self) -> tuple[str | None, str | None, str | None]:
        """Return (provider, api_key, model) for the currently active provider."""
        provider = await self.get_active_provider()
        if not provider:
            return None, None, None

        cfg = await self.get_provider_config(provider)
        if cfg:
            return provider, cfg.get("api_key") or None, cfg.get("model") or None

        # Legacy fallback
        legacy_prov = await self._get(_LEGACY_PROVIDER)
        if provider == legacy_prov:
            api_key = await self._get(_LEGACY_API_KEY)
            model = await self._get(_LEGACY_MODEL)
            return provider, api_key, model

        return provider, None, None

    # ── Embedding config ───────────────────────────────────────────────────────

    _KEY_EMBEDDING_VAULT_ID = "embedding_api_key_vault_id"
    _KEY_EMBEDDING_API_KEY_LEGACY = "embedding_api_key"  # legacy plain-text key

    async def get_embedding_api_key(self) -> str | None:
        """Return the OpenAI API key configured for embedding generation, or None."""
        vault_id = await self._get(self._KEY_EMBEDDING_VAULT_ID)
        if vault_id:
            return await self._vault_read(vault_id)
        # Legacy fallback: plain-text key from old format
        legacy_key = await self._get(self._KEY_EMBEDDING_API_KEY_LEGACY)
        if legacy_key:
            return legacy_key
        # Final fallback: use the OpenAI chat key
        cfg = await self.get_provider_config("openai")
        if cfg:
            return cfg.get("api_key") or None
        return None

    async def save_embedding_api_key(self, api_key: str) -> None:
        """Save the OpenAI API key for embeddings, encrypted via Vault."""
        existing_vault_id = await self._get(self._KEY_EMBEDDING_VAULT_ID)
        vault_id = await self._vault_store(
            secret_name=f"{self._tenant_id}_embedding_key",
            api_key=api_key,
            existing_vault_id=existing_vault_id,
        )
        await self._set(self._KEY_EMBEDDING_VAULT_ID, vault_id)

    async def get_embedding_config(self) -> tuple[str | None, str | None]:
        """Return (api_key, model). Model is always text-embedding-3-small."""
        api_key = await self.get_embedding_api_key()
        if not api_key:
            return None, None
        return api_key, "text-embedding-3-small"

    # ── Business context ───────────────────────────────────────────────────────

    _KEY_BUSINESS_CONTEXT = "business_context"

    BUSINESS_CONTEXT_FIELDS = (
        "company_description",
        "business_model",
        "fiscal_year_start",
        "currency",
        "revenue_definition",
        "churn_definition",
        "exclusions",
        "additional_context",
    )

    async def get_business_context(self) -> dict:
        raw = await self._get(self._KEY_BUSINESS_CONTEXT)
        if not raw:
            return {f: "" for f in self.BUSINESS_CONTEXT_FIELDS}
        try:
            data = json.loads(raw)
            return {f: data.get(f, "") for f in self.BUSINESS_CONTEXT_FIELDS}
        except (json.JSONDecodeError, TypeError):
            return {
                **{f: "" for f in self.BUSINESS_CONTEXT_FIELDS},
                "additional_context": raw,
            }

    async def save_business_context(self, fields: dict) -> None:
        safe = {f: str(fields.get(f, "")) for f in self.BUSINESS_CONTEXT_FIELDS}
        await self._set(self._KEY_BUSINESS_CONTEXT, json.dumps(safe))

    # ── Deprecated single-key helpers ─────────────────────────────────────────

    async def get(self, key: str) -> str | None:
        return await self._get(key)

    async def set(self, key: str, value: str) -> None:
        await self._set(key, value)

    async def get_all(self) -> dict[str, str]:
        result = await self._db.execute(
            select(AppSettingORM).where(AppSettingORM.tenant_id == self._tenant_id)
        )
        return {row.key: row.value for row in result.scalars().all()}
