import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ─── SQL execution ────────────────────────────────────────────────────────────

export interface SqlResponse {
  rows: Record<string, unknown>[];
  columns: string[];
  row_count: number;
  truncated: boolean;
  execution_time_ms: number;
  error: string | null;
}

interface RunQueryArgs {
  jobId: string;
  sql: string;
}

async function runQuery({ jobId, sql }: RunQueryArgs): Promise<SqlResponse> {
  return apiClient<SqlResponse>("/sql", {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, sql }),
  });
}

export function useSqlLab() {
  return useMutation<SqlResponse, Error, RunQueryArgs>({
    mutationFn: runQuery,
  });
}

// ─── Schema browser ───────────────────────────────────────────────────────────

export interface SchemaTable {
  schema_name: string;
  table_name: string;
  table_type: string;      // "BASE TABLE" | "VIEW"
  qualified_name: string;  // e.g. "src0.public.users"
}

export interface SchemaResponse {
  alias: string;
  tables: SchemaTable[];
  error: string | null;
}

export function useSchemaQuery(jobId: string | null) {
  return useQuery<SchemaResponse>({
    queryKey: ["sql-schema", jobId],
    queryFn: () => apiClient<SchemaResponse>(`/sql/schema?job_id=${jobId}`),
    enabled: !!jobId,
    staleTime: 60_000,  // schema rarely changes during a session
  });
}
