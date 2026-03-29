"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteJob, getJob, listJobs, startJob } from "@/lib/api/jobs";
import { getCatalog, getProfiles, getRelationships } from "@/lib/api/catalog";
import { getSemanticLayer, getSemanticYaml } from "@/lib/api/semantic";
import type { JobResponse, JobStatus, StartJobRequest } from "@/types/api";

const ACTIVE_STATUSES: JobStatus[] = ["pending", "bootstrapping", "running"];

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
  catalog: (id: string) => ["jobs", id, "catalog"] as const,
  profiles: (id: string) => ["jobs", id, "profiles"] as const,
  relationships: (id: string) => ["jobs", id, "relationships"] as const,
  semantic: (id: string) => ["jobs", id, "semantic"] as const,
  semanticYaml: (id: string) => ["jobs", id, "semantic.yaml"] as const,
};

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: listJobs,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const jobs = query.state.data as JobResponse[] | undefined;
      const hasActive = jobs?.some((j) => ACTIVE_STATUSES.includes(j.status));
      return hasActive ? 3000 : false;
    },
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => getJob(id),
    staleTime: 2_000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const job = query.state.data as JobResponse | undefined;
      return job && ACTIVE_STATUSES.includes(job.status) ? 2000 : false;
    },
  });
}

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartJobRequest) => startJob(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

export function useCatalog(jobId: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.catalog(jobId),
    queryFn: () => getCatalog(jobId),
    enabled,
  });
}

export function useProfiles(jobId: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.profiles(jobId),
    queryFn: () => getProfiles(jobId),
    enabled,
  });
}

export function useRelationships(jobId: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.relationships(jobId),
    queryFn: () => getRelationships(jobId),
    enabled,
  });
}

export function useSemanticLayer(jobId: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.semantic(jobId),
    queryFn: () => getSemanticLayer(jobId),
    enabled,
  });
}

export function useSemanticYaml(jobId: string, enabled = true) {
  return useQuery({
    queryKey: jobKeys.semanticYaml(jobId),
    queryFn: () => getSemanticYaml(jobId),
    enabled,
    staleTime: 60_000,
  });
}
