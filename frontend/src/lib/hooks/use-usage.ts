import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface UsageTotals {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  by_context: {
    discovery: number;
    agent: number;
    chat: number;
    communication_agent: number;
  };
}

export interface UsageCall {
  id: string;
  provider: string;
  model: string;
  context: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  job_id: string | null;
  created_at: string;
}

async function fetchUsage(): Promise<UsageTotals> {
  return apiClient<UsageTotals>("/usage");
}

async function fetchUsageCalls(): Promise<UsageCall[]> {
  return apiClient<UsageCall[]>("/usage/calls");
}

export function useUsage() {
  return useQuery<UsageTotals>({
    queryKey: ["usage"],
    queryFn: fetchUsage,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useUsageCalls() {
  return useQuery<UsageCall[]>({
    queryKey: ["usage-calls"],
    queryFn: fetchUsageCalls,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
