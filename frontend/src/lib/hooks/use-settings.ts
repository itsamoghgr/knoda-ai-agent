"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateProvider,
  getBusinessContext,
  getEmbeddingSettings,
  getSettings,
  saveBusinessContext,
  saveEmbeddingSettings,
  saveProvider,
  testLlmConnection,
} from "@/lib/api/settings";
import type {
  ActivateProviderRequest,
  SaveBusinessContextRequest,
  SaveEmbeddingRequest,
  SaveProviderRequest,
} from "@/types/api";

export const SETTINGS_KEY = ["settings"] as const;
export const EMBEDDING_SETTINGS_KEY = ["settings", "embedding"] as const;
export const BUSINESS_CONTEXT_KEY = ["settings", "business-context"] as const;

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: getSettings,
    staleTime: 30_000,
  });
}

export function useSaveProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveProviderRequest) => saveProvider(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}

export function useActivateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ActivateProviderRequest) => activateProvider(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}

export function useTestLlm() {
  return useMutation({ mutationFn: testLlmConnection });
}

export function useEmbeddingSettings() {
  return useQuery({
    queryKey: EMBEDDING_SETTINGS_KEY,
    queryFn: getEmbeddingSettings,
    staleTime: 30_000,
  });
}

export function useSaveEmbedding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveEmbeddingRequest) => saveEmbeddingSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: EMBEDDING_SETTINGS_KEY }),
  });
}

export function useBusinessContext() {
  return useQuery({
    queryKey: BUSINESS_CONTEXT_KEY,
    queryFn: getBusinessContext,
    staleTime: 30_000,
  });
}

export function useSaveBusinessContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveBusinessContextRequest) => saveBusinessContext(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: BUSINESS_CONTEXT_KEY }),
  });
}
