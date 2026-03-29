"use client";

/**
 * Chart Builder — /charts/builder
 *
 * Three-panel layout:
 *   Left:   Dataset & axis mapping
 *   Right:  Live ECharts preview
 *   Bottom: Customization controls
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  BarChart3,
  Circle,
  Loader2,
  LineChart,
  PieChart,
  Table2,
  TrendingUp,
  Save,
  ScatterChart,
  Layers,
  ArrowDownUp,
  Grid3X3,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useDatasets, useDatasetData, useCreateChart } from "@/lib/hooks/use-charts";
import ChartRenderer from "@/components/charts/ChartRenderer";
import type { ChartConfig, ChartType } from "@/types/api";

// ─── Chart type catalog ───────────────────────────────────────────────────────

const CHART_TYPES: { type: ChartType; label: string; icon: React.ReactNode; needsY: boolean }[] = [
  { type: "bar",     label: "Bar",     icon: <BarChart2 className="h-4 w-4" />,      needsY: true  },
  { type: "line",    label: "Line",    icon: <LineChart className="h-4 w-4" />,       needsY: true  },
  { type: "area",    label: "Area",    icon: <TrendingUp className="h-4 w-4" />,      needsY: true  },
  { type: "pie",     label: "Pie",     icon: <PieChart className="h-4 w-4" />,        needsY: false },
  { type: "donut",   label: "Donut",   icon: <Circle className="h-4 w-4" />,          needsY: false },
  { type: "scatter", label: "Scatter", icon: <ScatterChart className="h-4 w-4" />,    needsY: true  },
  { type: "combo",   label: "Combo",   icon: <Layers className="h-4 w-4" />,          needsY: true  },
  { type: "funnel",  label: "Funnel",  icon: <ArrowDownUp className="h-4 w-4" />,     needsY: false },
  { type: "heatmap", label: "Heatmap", icon: <Grid3X3 className="h-4 w-4" />,         needsY: true  },
  { type: "kpi",     label: "KPI",     icon: <BarChart3 className="h-4 w-4" />,       needsY: false },
  { type: "table",   label: "Table",   icon: <Table2 className="h-4 w-4" />,          needsY: false },
];

// ─── Defaults ─────────────────────────────────────────────────────────────────

function defaultConfig(chartType: ChartType, columns: string[]): ChartConfig {
  const cat = columns.find((c) => typeof c === "string") ?? columns[0] ?? "";
  const nums = columns.filter((c) => c !== cat).slice(0, 3);
  return {
    x_column: cat,
    y_columns: nums,
    show_legend: true,
    show_grid: true,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChartBuilderPage() {
  const router = useRouter();
  const { data: datasets = [], isLoading: datasetsLoading } = useDatasets();
  const createChart = useCreateChart();

  // ── State ──────────────────────────────────────────────────────────────────
  const [datasetId, setDatasetId] = useState<string>("");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [chartName, setChartName] = useState("");
  const [config, setConfig] = useState<ChartConfig>({
    x_column: undefined,
    y_columns: [],
    show_legend: true,
    show_grid: true,
  });

  // ── Dataset data ───────────────────────────────────────────────────────────
  const { data: datasetData, isLoading: dataLoading } = useDatasetData(datasetId || null);

  const columns: string[] = useMemo(
    () => datasetData?.columns ?? [],
    [datasetData],
  );
  const rows = useMemo(() => datasetData?.rows ?? [], [datasetData]);

  // Auto-set defaults when dataset loads
  const handleDatasetChange = useCallback(
    (id: string | null) => {
      setDatasetId(id ?? "");
      setConfig({ x_column: undefined, y_columns: [], show_legend: true, show_grid: true });
    },
    [],
  );

  // Patch config when columns are available for the first time
  const effectiveConfig: ChartConfig = useMemo(() => {
    if (!config.x_column && columns.length > 0) {
      return defaultConfig(chartType, columns);
    }
    return config;
  }, [config, columns, chartType]);

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!datasetId) { toast.error("Pick a dataset first"); return; }
    if (!chartName.trim()) { toast.error("Give your chart a name"); return; }
    try {
      const chart = await createChart.mutateAsync({
        dataset_id: datasetId,
        name: chartName.trim(),
        chart_type: chartType,
        config: effectiveConfig,
      });
      toast.success("Chart saved!");
      router.push(`/charts/${chart.id}`);
    } catch {
      toast.error("Failed to save chart");
    }
  }

  // ── Column toggle helper ───────────────────────────────────────────────────
  function toggleYColumn(col: string) {
    setConfig((prev) => {
      const yCols = prev.y_columns ?? [];
      return {
        ...prev,
        y_columns: yCols.includes(col)
          ? yCols.filter((c) => c !== col)
          : [...yCols, col],
      };
    });
  }

  const yColumns = effectiveConfig.y_columns ?? [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-6 py-3">
        <div>
          <h1 className="text-base font-semibold">Chart Builder</h1>
          <p className="text-xs text-muted-foreground">Configure and preview your chart</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={createChart.isPending || !datasetId || !chartName.trim()}>
            {createChart.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save Chart
          </Button>
        </div>
      </div>

      {/* Body: left config + right preview */}
      <div className="flex min-h-0 flex-1">
        {/* ── Left panel ── */}
        <div className="flex w-72 shrink-0 flex-col gap-0 overflow-y-auto border-r bg-card">
          {/* Chart name */}
          <section className="p-4">
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Chart Name
            </Label>
            <Input
              placeholder="e.g. Revenue by Region"
              value={chartName}
              onChange={(e) => setChartName(e.target.value)}
              className="h-8 text-sm"
            />
          </section>

          <Separator />

          {/* Dataset */}
          <section className="p-4">
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Dataset
            </Label>
            {datasetsLoading ? (
              <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : (
              <Select value={datasetId} onValueChange={handleDatasetChange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Pick a dataset…" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </section>

          <Separator />

          {/* Chart type */}
          <section className="p-4">
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">
              Chart Type
            </Label>
            <div className="grid grid-cols-3 gap-1.5">
              {CHART_TYPES.map(({ type, label, icon }) => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] font-medium transition-colors ${
                    chartType === type
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </section>

          <Separator />

          {/* Axis mapping */}
          {columns.length > 0 && (
            <section className="p-4">
              <Label className="text-xs font-medium text-muted-foreground mb-3 block">
                Axes
              </Label>

              {/* X-axis / Label */}
              <div className="mb-3">
                <Label className="text-[10px] text-muted-foreground mb-1 block">
                  {chartType === "pie" || chartType === "donut" || chartType === "funnel"
                    ? "Label column"
                    : "X-axis / Dimension"}
                </Label>
                <Select
                  value={effectiveConfig.x_column ?? ""}
                  onValueChange={(v) => setConfig((p) => ({ ...p, x_column: v }))}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Pick column…" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Y-axis / Values */}
              {chartType !== "table" && (
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1 block">
                    {chartType === "pie" || chartType === "donut" || chartType === "kpi"
                      ? "Value column"
                      : "Y-axis / Measures (pick one or more)"}
                  </Label>
                  <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
                    {columns
                      .filter((c) => c !== effectiveConfig.x_column)
                      .map((c) => (
                        <button
                          key={c}
                          onClick={() => toggleYColumn(c)}
                          className={`flex items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
                            yColumns.includes(c)
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <span className="truncate">{c}</span>
                          {yColumns.includes(c) && (
                            <span className="ml-1 shrink-0 rounded bg-primary/20 px-1 py-0.5 text-[9px] font-bold">
                              Y
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <Separator />

          {/* Customization */}
          <section className="p-4">
            <Label className="text-xs font-medium text-muted-foreground mb-3 block">
              Display Options
            </Label>
            <div className="flex flex-col gap-2">
              {/* Legend toggle */}
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-xs">Show legend</span>
                <button
                  role="switch"
                  aria-checked={effectiveConfig.show_legend ?? true}
                  onClick={() =>
                    setConfig((p) => ({ ...p, show_legend: !p.show_legend }))
                  }
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    effectiveConfig.show_legend ?? true
                      ? "bg-primary"
                      : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      effectiveConfig.show_legend ?? true
                        ? "translate-x-3.5"
                        : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>

              {/* Grid toggle */}
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-xs">Show grid lines</span>
                <button
                  role="switch"
                  aria-checked={effectiveConfig.show_grid ?? true}
                  onClick={() =>
                    setConfig((p) => ({ ...p, show_grid: !p.show_grid }))
                  }
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    effectiveConfig.show_grid ?? true
                      ? "bg-primary"
                      : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      effectiveConfig.show_grid ?? true
                        ? "translate-x-3.5"
                        : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>

              {/* Stack toggle (bar/area/line only) */}
              {(chartType === "bar" || chartType === "area" || chartType === "line") && (
                <label className="flex cursor-pointer items-center justify-between">
                  <span className="text-xs">Stack series</span>
                  <button
                    role="switch"
                    aria-checked={effectiveConfig.stack ?? false}
                    onClick={() =>
                      setConfig((p) => ({ ...p, stack: !p.stack }))
                    }
                    className={`relative h-4 w-7 rounded-full transition-colors ${
                      effectiveConfig.stack
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                        effectiveConfig.stack ? "translate-x-3.5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </label>
              )}

              {/* Horizontal layout (bar only) */}
              {chartType === "bar" && (
                <label className="flex cursor-pointer items-center justify-between">
                  <span className="text-xs">Horizontal bars</span>
                  <button
                    role="switch"
                    aria-checked={effectiveConfig.bar_layout === "horizontal"}
                    onClick={() =>
                      setConfig((p) => ({
                        ...p,
                        bar_layout:
                          p.bar_layout === "horizontal" ? "vertical" : "horizontal",
                      }))
                    }
                    className={`relative h-4 w-7 rounded-full transition-colors ${
                      effectiveConfig.bar_layout === "horizontal"
                        ? "bg-primary"
                        : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                        effectiveConfig.bar_layout === "horizontal"
                          ? "translate-x-3.5"
                          : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </label>
              )}
            </div>
          </section>
        </div>

        {/* ── Right preview panel ── */}
        <div className="flex min-h-0 flex-1 flex-col bg-muted/20">
          {/* Preview header */}
          <div className="flex shrink-0 items-center justify-between border-b bg-card px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Live Preview
            </span>
            {dataLoading && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading data…
              </div>
            )}
            {rows.length > 0 && !dataLoading && (
              <span className="text-xs text-muted-foreground">
                {rows.length.toLocaleString()} rows
              </span>
            )}
          </div>

          {/* Preview area */}
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {!datasetId ? (
              <div className="text-center text-sm text-muted-foreground">
                <BarChart2 className="mx-auto mb-3 h-10 w-10 opacity-20" />
                <p className="font-medium">Pick a dataset to get started</p>
                <p className="text-xs mt-1">Your chart preview will appear here</p>
              </div>
            ) : dataLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : rows.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground">
                <p>No data in this dataset</p>
              </div>
            ) : (
              <div className="h-full w-full rounded-lg border border-border/40 bg-card p-4">
                <div className="mb-1 min-h-0">
                  {chartName && (
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      {chartName}
                    </p>
                  )}
                </div>
                <div className="h-[calc(100%-2rem)]">
                  <ChartRenderer
                    chartType={chartType}
                    config={effectiveConfig}
                    columns={columns}
                    rows={rows}
                    height="100%"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
