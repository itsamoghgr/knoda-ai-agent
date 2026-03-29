"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart2,
  BarChart3,
  ChevronRight,
  Circle,
  LineChart,
  Loader2,
  PieChart,
  Play,
  Save,
  Table2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useCreateDataset, useCreateChart } from "@/lib/hooks/use-charts";
import { getDatasetData } from "@/lib/api/charts";
import ChartRenderer from "@/components/charts/ChartRenderer";
import type { ChartConfig, ChartType, DatasetDataResponse } from "@/types/api";
import { cn } from "@/lib/utils";

// ─── Chart type palette ───────────────────────────────────────────────────────

const CHART_TYPES: Array<{ type: ChartType; label: string; icon: React.ReactNode }> = [
  { type: "bar", label: "Bar", icon: <BarChart2 className="h-5 w-5" /> },
  { type: "line", label: "Line", icon: <LineChart className="h-5 w-5" /> },
  { type: "area", label: "Area", icon: <TrendingUp className="h-5 w-5" /> },
  { type: "pie", label: "Pie", icon: <PieChart className="h-5 w-5" /> },
  { type: "donut", label: "Donut", icon: <Circle className="h-5 w-5" /> },
  { type: "kpi", label: "KPI", icon: <BarChart3 className="h-5 w-5" /> },
  { type: "table", label: "Table", icon: <Table2 className="h-5 w-5" /> },
];

const SOURCE_EMOJI: Record<string, string> = {
  postgres: "🐘",
  mysql: "🐬",
  duckdb: "🦆",
  s3_parquet: "☁️",
};

function ChartBuilderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialJobId = searchParams.get("job_id") ?? "";
  const initialSql = searchParams.get("sql")
    ? decodeURIComponent(searchParams.get("sql")!)
    : "";

  const { data: jobs = [] } = useJobs();
  const completedJobs = jobs.filter((j) => j.status === "completed");

  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [sql, setSql] = useState(
    initialSql || "-- Write your SQL query here\nSELECT * FROM ..."
  );
  const [chartName, setChartName] = useState("");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [config, setConfig] = useState<ChartConfig>({
    show_grid: true,
    show_legend: true,
    stack: false,
    bar_layout: "vertical",
  });
  const [dataResult, setDataResult] = useState<DatasetDataResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedDatasetId, setSavedDatasetId] = useState<string | null>(null);

  const createDataset = useCreateDataset();
  const createChart = useCreateChart();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keyboard shortcut: Cmd/Ctrl+Enter to run
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleRun();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const columns = dataResult?.columns ?? [];

  async function handleRun() {
    if (!selectedJobId) {
      toast.error("Select a database first");
      return;
    }
    if (!sql.trim()) {
      toast.error("Enter a SQL query");
      return;
    }
    setIsRunning(true);
    setDataResult(null);
    setSavedDatasetId(null);
    try {
      // Save a temporary dataset, run its data endpoint
      const ds = await createDataset.mutateAsync({
        job_id: selectedJobId,
        name: `__preview_${Date.now()}`,
        sql: sql.trim(),
        description: "__preview",
      });
      const result = await getDatasetData(ds.id);
      setDataResult(result);
      setSavedDatasetId(ds.id);
      if (result.error) {
        toast.error("Query error: " + result.error);
      } else {
        toast.success(`${result.row_count} rows in ${result.execution_time_ms}ms`);
        // auto-configure x/y from columns
        const cols = result.columns;
        if (cols.length >= 2 && !config.x_column) {
          setConfig((prev) => ({
            ...prev,
            x_column: cols[0],
            y_columns: cols.slice(1),
          }));
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to run query");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleSave() {
    if (!chartName.trim()) {
      toast.error("Give the chart a name");
      return;
    }
    if (!savedDatasetId) {
      toast.error("Run the query first to preview the data");
      return;
    }
    setIsSaving(true);
    try {
      // Update the dataset to have a real name
      const ds = await createDataset.mutateAsync({
        job_id: selectedJobId,
        name: chartName.trim(),
        sql: sql.trim(),
        description: "",
      });
      const chart = await createChart.mutateAsync({
        dataset_id: ds.id,
        name: chartName.trim(),
        chart_type: chartType,
        config,
        description: "",
      });
      toast.success("Chart saved!");
      router.push(`/charts/${chart.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  function updateConfig(key: keyof ChartConfig, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  const isPieType = chartType === "pie" || chartType === "donut";
  const isKpi = chartType === "kpi";

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left panel */}
      <div className="flex w-[420px] shrink-0 flex-col border-r bg-card">
        {/* Header */}
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground"
              onClick={() => router.push("/charts")}
            >
              Charts
            </span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground">New Chart</span>
          </div>
          <h1 className="mt-1 text-lg font-semibold">Chart Builder</h1>
        </div>

        {/* DB selector */}
        <div className="border-b px-4 py-3">
          <Label className="mb-1.5 block text-xs text-muted-foreground">
            Database
          </Label>
          <Select value={selectedJobId} onValueChange={(v) => setSelectedJobId(v ?? "")}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a database…" />
            </SelectTrigger>
            <SelectContent>
              {completedJobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {SOURCE_EMOJI[j.source_type] ?? "🗄️"}{" "}
                  {(j.source_config_safe as Record<string, string>)?.database ??
                    (j.source_config_safe as Record<string, string>)?.file_path ??
                    j.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* SQL editor */}
        <div className="flex flex-1 flex-col overflow-hidden px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">SQL Query</Label>
            <span className="text-[10px] text-muted-foreground">⌘↵ to run</span>
          </div>
          <Textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="flex-1 resize-none font-mono text-xs"
            placeholder="SELECT ..."
            spellCheck={false}
          />
          <Button
            onClick={handleRun}
            disabled={isRunning || !selectedJobId}
            className="mt-3"
            size="sm"
          >
            {isRunning ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-2 h-3.5 w-3.5" />
            )}
            Run Preview
          </Button>
        </div>

        {/* Data preview */}
        {dataResult && (
          <div className="border-t">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs font-medium">
                {dataResult.error ? (
                  <span className="text-destructive">{dataResult.error}</span>
                ) : (
                  <span>
                    {dataResult.row_count} rows •{" "}
                    {dataResult.execution_time_ms}ms
                  </span>
                )}
              </span>
            </div>
            {!dataResult.error && (
              <div className="max-h-40 overflow-auto border-t px-0">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr>
                      {dataResult.columns.map((c) => (
                        <th
                          key={c}
                          className="px-3 py-1.5 text-left font-medium text-muted-foreground"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataResult.rows.slice(0, 5).map((row, ri) => (
                      <tr key={ri} className="border-t">
                        {dataResult.columns.map((c) => (
                          <td key={c} className="px-3 py-1 font-mono">
                            {row[c] != null ? String(row[c]) : ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Chart preview */}
        <div className="flex flex-1 items-center justify-center bg-background p-8">
          {dataResult && !dataResult.error ? (
            <div className="w-full max-w-3xl rounded-xl border bg-card p-6 shadow-sm">
              <ChartRenderer
                chartType={chartType}
                config={config}
                columns={dataResult.columns}
                rows={dataResult.rows}
                height={340}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <BarChart2 className="h-16 w-16 opacity-20" />
              <p className="text-sm">Run a query to preview your chart</p>
            </div>
          )}
        </div>

        {/* Config panel */}
        <div className="border-t bg-card px-6 py-4">
          <div className="grid grid-cols-[1fr_320px] gap-6">
            {/* Chart type + axis */}
            <div className="space-y-4">
              {/* Chart type */}
              <div>
                <Label className="mb-2 block text-xs text-muted-foreground">
                  Chart Type
                </Label>
                <div className="flex flex-wrap gap-2">
                  {CHART_TYPES.map(({ type, label, icon }) => (
                    <button
                      key={type}
                      onClick={() => setChartType(type)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                        chartType === type
                          ? "border-primary bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      )}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Axis config */}
              {columns.length > 0 && !isKpi && (
                <div className="grid grid-cols-2 gap-3">
                  {!isPieType && (
                    <div>
                      <Label className="mb-1 block text-xs text-muted-foreground">
                        X Axis
                      </Label>
                      <Select
                        value={config.x_column ?? ""}
                        onValueChange={(v) => updateConfig("x_column", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Column…" />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {isPieType ? (
                    <>
                      <div>
                        <Label className="mb-1 block text-xs text-muted-foreground">
                          Label
                        </Label>
                        <Select
                          value={config.label_column ?? ""}
                          onValueChange={(v) => updateConfig("label_column", v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Column…" />
                          </SelectTrigger>
                          <SelectContent>
                            {columns.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs text-muted-foreground">
                          Value
                        </Label>
                        <Select
                          value={config.value_column ?? ""}
                          onValueChange={(v) => updateConfig("value_column", v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Column…" />
                          </SelectTrigger>
                          <SelectContent>
                            {columns.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div>
                      <Label className="mb-1 block text-xs text-muted-foreground">
                        Y Axis (multi-select)
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {columns
                          .filter((c) => c !== config.x_column)
                          .map((c) => {
                            const selected =
                              config.y_columns?.includes(c) ?? false;
                            return (
                              <button
                                key={c}
                                onClick={() => {
                                  const prev = config.y_columns ?? [];
                                  updateConfig(
                                    "y_columns",
                                    selected
                                      ? prev.filter((x) => x !== c)
                                      : [...prev, c]
                                  );
                                }}
                                className={cn(
                                  "rounded border px-2 py-0.5 text-xs transition-colors",
                                  selected
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "hover:bg-muted"
                                )}
                              >
                                {c}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* KPI value col */}
              {isKpi && columns.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">
                      Value column
                    </Label>
                    <Select
                      value={config.value_column ?? ""}
                      onValueChange={(v) => updateConfig("value_column", v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Column…" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">
                      Label column (optional)
                    </Label>
                    <Select
                      value={config.label_column ?? ""}
                      onValueChange={(v) => updateConfig("label_column", v === "__none__" ? null : v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* Save panel */}
            <div className="flex flex-col gap-3 border-l pl-6">
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  Chart Name
                </Label>
                <Input
                  value={chartName}
                  onChange={(e) => setChartName(e.target.value)}
                  placeholder="e.g. Monthly Revenue"
                  className="h-9"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-2">
                {!isPieType && !isKpi && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Show grid</Label>
                      <Switch
                        checked={config.show_grid ?? true}
                        onCheckedChange={(v) => updateConfig("show_grid", v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Show legend</Label>
                      <Switch
                        checked={config.show_legend ?? true}
                        onCheckedChange={(v) => updateConfig("show_legend", v)}
                      />
                    </div>
                    {(chartType === "bar" || chartType === "area") && (
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Stack series</Label>
                        <Switch
                          checked={config.stack ?? false}
                          onCheckedChange={(v) => updateConfig("stack", v)}
                        />
                      </div>
                    )}
                    {chartType === "bar" && (
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Horizontal bars</Label>
                        <Switch
                          checked={config.bar_layout === "horizontal"}
                          onCheckedChange={(v) =>
                            updateConfig(
                              "bar_layout",
                              v ? "horizontal" : "vertical"
                            )
                          }
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              <Separator />

              <Button onClick={handleSave} disabled={isSaving || !savedDatasetId}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Chart
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/charts")}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewChartPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ChartBuilderInner />
    </Suspense>
  );
}
