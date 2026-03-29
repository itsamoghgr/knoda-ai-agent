import type { SemanticModel } from "@/types/api";
import { apiClient, apiUrl } from "./client";

export const getSemanticLayer = (jobId: string): Promise<SemanticModel[]> =>
  apiClient<SemanticModel[]>(`/jobs/${jobId}/semantic`);

export const getSemanticYaml = async (jobId: string): Promise<string> => {
  const response = await fetch(apiUrl(`/jobs/${jobId}/semantic.yaml`));
  if (!response.ok) throw new Error("Failed to fetch YAML");
  return response.text();
};

export const updateDimension = (
  jobId: string,
  dimensionId: string,
  body: { description?: string; time_granularity?: string },
): Promise<{ status: string; id: string }> =>
  apiClient(`/jobs/${jobId}/semantic/dimensions/${dimensionId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
