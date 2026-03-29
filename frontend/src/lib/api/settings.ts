import type {
  ActivateProviderRequest,
  AppSettings,
  BusinessContextResponse,
  EmbeddingSettings,
  SaveBusinessContextRequest,
  SaveEmbeddingRequest,
  SaveProviderRequest,
  TestLlmResult,
} from "@/types/api";
import { apiClient } from "./client";

export const getSettings = (): Promise<AppSettings> =>
  apiClient<AppSettings>("/settings");

export const saveProvider = (body: SaveProviderRequest): Promise<AppSettings> =>
  apiClient<AppSettings>("/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const activateProvider = (body: ActivateProviderRequest): Promise<AppSettings> =>
  apiClient<AppSettings>("/settings/activate", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const testLlmConnection = (): Promise<TestLlmResult> =>
  apiClient<TestLlmResult>("/settings/test-llm", { method: "POST", body: "{}" });

export const getEmbeddingSettings = (): Promise<EmbeddingSettings> =>
  apiClient<EmbeddingSettings>("/settings/embedding");

export const saveEmbeddingSettings = (body: SaveEmbeddingRequest): Promise<EmbeddingSettings> =>
  apiClient<EmbeddingSettings>("/settings/embedding", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const getBusinessContext = (): Promise<BusinessContextResponse> =>
  apiClient<BusinessContextResponse>("/settings/business-context");

export const saveBusinessContext = (body: SaveBusinessContextRequest): Promise<BusinessContextResponse> =>
  apiClient<BusinessContextResponse>("/settings/business-context", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
