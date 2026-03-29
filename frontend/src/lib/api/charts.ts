import type {
  Chart,
  ChartConfig,
  ChartType,
  Dashboard,
  DashboardDetail,
  Dataset,
  DatasetDataResponse,
} from "@/types/api";
import { apiClient } from "./client";

// ─── Datasets ─────────────────────────────────────────────────────────────────

export const listDatasets = (jobId?: string): Promise<Dataset[]> => {
  const qs = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  return apiClient<Dataset[]>(`/datasets${qs}`);
};

export const createDataset = (body: {
  job_id: string;
  name: string;
  sql: string;
  description?: string;
}): Promise<Dataset> =>
  apiClient<Dataset>("/datasets", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getDataset = (id: string): Promise<Dataset> =>
  apiClient<Dataset>(`/datasets/${id}`);

export const updateDataset = (
  id: string,
  body: Partial<Pick<Dataset, "name" | "sql" | "description">>
): Promise<Dataset> =>
  apiClient<Dataset>(`/datasets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteDataset = (id: string): Promise<void> =>
  apiClient<void>(`/datasets/${id}`, { method: "DELETE" });

export const getDatasetData = (id: string): Promise<DatasetDataResponse> =>
  apiClient<DatasetDataResponse>(`/datasets/${id}/data`);

// ─── Charts ───────────────────────────────────────────────────────────────────

export const listCharts = (datasetId?: string): Promise<Chart[]> => {
  const qs = datasetId ? `?dataset_id=${encodeURIComponent(datasetId)}` : "";
  return apiClient<Chart[]>(`/charts${qs}`);
};

export const createChart = (body: {
  dataset_id: string;
  name: string;
  chart_type: ChartType;
  config: ChartConfig;
  description?: string;
}): Promise<Chart> =>
  apiClient<Chart>("/charts", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getChart = (id: string): Promise<Chart> =>
  apiClient<Chart>(`/charts/${id}`);

export const updateChart = (
  id: string,
  body: Partial<Pick<Chart, "name" | "chart_type" | "config" | "description">>
): Promise<Chart> =>
  apiClient<Chart>(`/charts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteChart = (id: string): Promise<void> =>
  apiClient<void>(`/charts/${id}`, { method: "DELETE" });

// ─── Dashboards ───────────────────────────────────────────────────────────────

export const listDashboards = (): Promise<Dashboard[]> =>
  apiClient<Dashboard[]>("/dashboards");

export const createDashboard = (body: {
  name: string;
  description?: string;
}): Promise<Dashboard> =>
  apiClient<Dashboard>("/dashboards", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getDashboard = (id: string): Promise<DashboardDetail> =>
  apiClient<DashboardDetail>(`/dashboards/${id}`);

export const updateDashboard = (
  id: string,
  body: Partial<Pick<Dashboard, "name" | "description">>
): Promise<Dashboard> =>
  apiClient<Dashboard>(`/dashboards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteDashboard = (id: string): Promise<void> =>
  apiClient<void>(`/dashboards/${id}`, { method: "DELETE" });

export const addChartToDashboard = (
  dashboardId: string,
  body: {
    chart_id: string;
    grid_x?: number;
    grid_y?: number;
    grid_w?: number;
    grid_h?: number;
  }
): Promise<unknown> =>
  apiClient<unknown>(`/dashboards/${dashboardId}/charts`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const removeChartFromDashboard = (
  dashboardId: string,
  chartId: string
): Promise<void> =>
  apiClient<void>(`/dashboards/${dashboardId}/charts/${chartId}`, {
    method: "DELETE",
  });

export const updateDashboardLayout = (
  dashboardId: string,
  layout: Array<{
    chart_id: string;
    grid_x: number;
    grid_y: number;
    grid_w: number;
    grid_h: number;
  }>
): Promise<unknown> =>
  apiClient<unknown>(`/dashboards/${dashboardId}/layout`, {
    method: "PATCH",
    body: JSON.stringify({ layout }),
  });

export const refreshDashboard = (dashboardId: string): Promise<unknown> =>
  apiClient<unknown>(`/dashboards/${dashboardId}/refresh`, { method: "POST" });
