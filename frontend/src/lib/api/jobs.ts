import type { JobResponse, StartJobRequest } from "@/types/api";
import { apiClient } from "./client";

export const listJobs = (): Promise<JobResponse[]> => apiClient<JobResponse[]>("/jobs");

export const getJob = (id: string): Promise<JobResponse> => apiClient<JobResponse>(`/jobs/${id}`);

export const startJob = (body: StartJobRequest): Promise<JobResponse> =>
  apiClient<JobResponse>("/jobs", { method: "POST", body: JSON.stringify(body) });

export const deleteJob = (id: string): Promise<void> =>
  apiClient<void>(`/jobs/${id}`, { method: "DELETE" });
