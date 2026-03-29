import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Chart,
  ChartConfig,
  ChartType,
  Dashboard,
  DashboardDetail,
  Dataset,
} from "@/types/api";
import * as chartsApi from "@/lib/api/charts";

// ─── Query keys ───────────────────────────────────────────────────────────────

export const datasetKeys = {
  all: ["datasets"] as const,
  list: (jobId?: string) => ["datasets", "list", jobId ?? "all"] as const,
  detail: (id: string) => ["datasets", "detail", id] as const,
  data: (id: string) => ["datasets", "data", id] as const,
};

export const chartKeys = {
  all: ["charts"] as const,
  list: (datasetId?: string) => ["charts", "list", datasetId ?? "all"] as const,
  detail: (id: string) => ["charts", "detail", id] as const,
};

export const dashboardKeys = {
  all: ["dashboards"] as const,
  list: () => ["dashboards", "list"] as const,
  detail: (id: string) => ["dashboards", "detail", id] as const,
};

// ─── Dataset hooks ────────────────────────────────────────────────────────────

export function useDatasets(jobId?: string) {
  return useQuery<Dataset[]>({
    queryKey: datasetKeys.list(jobId),
    queryFn: () => chartsApi.listDatasets(jobId),
    staleTime: 30_000,
  });
}

export function useDataset(id: string | null) {
  return useQuery<Dataset>({
    queryKey: datasetKeys.detail(id!),
    queryFn: () => chartsApi.getDataset(id!),
    enabled: !!id,
  });
}

export function useDatasetData(id: string | null) {
  return useQuery({
    queryKey: datasetKeys.data(id!),
    queryFn: () => chartsApi.getDatasetData(id!),
    enabled: !!id,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCreateDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chartsApi.createDataset,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });
}

export function useUpdateDataset(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Dataset, "name" | "sql" | "description">>) =>
      chartsApi.updateDataset(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });
}

export function useDeleteDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chartsApi.deleteDataset,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: datasetKeys.all });
    },
  });
}

// ─── Chart hooks ──────────────────────────────────────────────────────────────

export function useCharts(datasetId?: string) {
  return useQuery<Chart[]>({
    queryKey: chartKeys.list(datasetId),
    queryFn: () => chartsApi.listCharts(datasetId),
    staleTime: 30_000,
  });
}

export function useChart(id: string | null) {
  return useQuery<Chart>({
    queryKey: chartKeys.detail(id!),
    queryFn: () => chartsApi.getChart(id!),
    enabled: !!id,
  });
}

export function useCreateChart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chartsApi.createChart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chartKeys.all });
    },
  });
}

export function useUpdateChart(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      body: Partial<Pick<Chart, "name" | "chart_type" | "config" | "description">>
    ) => chartsApi.updateChart(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chartKeys.all });
    },
  });
}

export function useDeleteChart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chartsApi.deleteChart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chartKeys.all });
    },
  });
}

// ─── Dashboard hooks ──────────────────────────────────────────────────────────

export function useDashboards() {
  return useQuery<Dashboard[]>({
    queryKey: dashboardKeys.list(),
    queryFn: chartsApi.listDashboards,
    staleTime: 30_000,
  });
}

export function useDashboard(id: string | null) {
  return useQuery<DashboardDetail>({
    queryKey: dashboardKeys.detail(id!),
    queryFn: () => chartsApi.getDashboard(id!),
    enabled: !!id,
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chartsApi.createDashboard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useUpdateDashboard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Dashboard, "name" | "description">>) =>
      chartsApi.updateDashboard(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
      qc.invalidateQueries({ queryKey: dashboardKeys.detail(id) });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chartsApi.deleteDashboard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useAddChartToDashboard(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      chart_id: string;
      grid_x?: number;
      grid_y?: number;
      grid_w?: number;
      grid_h?: number;
    }) => chartsApi.addChartToDashboard(dashboardId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardKeys.detail(dashboardId) });
    },
  });
}

export function useRemoveChartFromDashboard(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chartId: string) =>
      chartsApi.removeChartFromDashboard(dashboardId, chartId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardKeys.detail(dashboardId) });
    },
  });
}

export function useUpdateDashboardLayout(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      layout: Array<{
        chart_id: string;
        grid_x: number;
        grid_y: number;
        grid_w: number;
        grid_h: number;
      }>
    ) => chartsApi.updateDashboardLayout(dashboardId, layout),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashboardKeys.detail(dashboardId) });
    },
  });
}

export function useRefreshDashboard(dashboardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => chartsApi.refreshDashboard(dashboardId),
    onSuccess: () => {
      // Re-fetch dashboard so ChartWidgets get fresh snapshot data
      qc.invalidateQueries({ queryKey: dashboardKeys.detail(dashboardId) });
    },
  });
}
