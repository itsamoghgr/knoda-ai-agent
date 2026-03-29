import type { AppSettings, LlmProvider } from "@/types/api";

/**
 * True when an active provider is set and ready for discovery/chat.
 * Ollama does not require an API key; other providers require a saved key.
 */
export function isLlmConfigured(settings: AppSettings | undefined): boolean {
  if (!settings?.active_provider) return false;
  const id = settings.active_provider;
  const cfg = settings.providers?.[id as LlmProvider];
  if (!cfg?.model) return false;
  if (id === "ollama") return true;
  return cfg.api_key_set === true;
}

/** Short label for UI, e.g. "anthropic · claude-sonnet-4-5" */
export function getActiveLlmLabel(settings: AppSettings | undefined): string | null {
  if (!settings?.active_provider) return null;
  const id = settings.active_provider;
  const model = settings.providers?.[id as LlmProvider]?.model;
  if (!model) return null;
  return `${id} · ${model}`;
}
