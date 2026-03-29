import type { ConnectorInfo, ProfileResult, Relationship, TableMeta } from "@/types/api";
import { apiClient, apiUrl } from "./client";

export const getCatalog = (jobId: string): Promise<TableMeta[]> =>
  apiClient<TableMeta[]>(`/jobs/${jobId}/catalog`);

export const getProfiles = (jobId: string): Promise<ProfileResult[]> =>
  apiClient<ProfileResult[]>(`/jobs/${jobId}/profiles`);

export const getRelationships = (jobId: string): Promise<Relationship[]> =>
  apiClient<Relationship[]>(`/jobs/${jobId}/relationships`);

export const getConnectors = (): Promise<ConnectorInfo[]> =>
  apiClient<ConnectorInfo[]>("/connectors");

export async function downloadSemanticYaml(jobId: string): Promise<void> {
  const response = await fetch(apiUrl(`/jobs/${jobId}/semantic.yaml`));
  if (!response.ok) throw new Error("Failed to download YAML");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `semantic_layer_${jobId.slice(0, 8)}.yaml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
