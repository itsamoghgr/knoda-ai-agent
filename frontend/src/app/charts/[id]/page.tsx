"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  BarChart3,
  Circle,
  ChevronRight,
  LineChart,
  Loader2,
  PieChart,
  Save,
  Table2,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useChart, useDataset, useDatasetData, useDeleteChart, useUpdateChart } from "@/lib/hooks/use-charts";
import ChartRenderer from "@/components/charts/ChartRenderer";
import type { ChartConfig, ChartType } from "@/types/api";
import { cn } from "@/lib/utils";

const CHART_TYPES: Array<{ type: ChartType; label: string; icon: React.ReactNode }> = [
  { type: "bar", label: "Bar", icon: <BarChart2 className="h-5 w-5" /> },
  { type: "line", label: "Line", icon: <LineChart className="h-5 w-5" /> },
  { type: "area", label: "Area", icon: <TrendingUp className="h-5 w-5" /> },
  { type: "pie", label: "Pie", icon: <PieChart className="h-5 w-5" /> },
  { type: "donut", label: "Donut", icon: <Circle className="h-5 w-5" /> },
  { type: "kpi", label: "KPI", icon: <BarChart3 className="h-5 w-5" /> },
  { type: "table", label: "Table", icon: <Table2 className="h-5 w-5" /> },
];

export default function ChartDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: chart, isLoading: chartLoading } = useChart(id);
  const { data: dataset } = useDataset(chart?.dataset_id ?? null);
  const { data: dataResult, isLoading: dataLoading } = useDatasetData(
    chart?.dataset_id ?? null
  );

  const updateChart = useUpdateChart(id);
  const deleteChart = useDeleteChart();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [chartName, setChartName] = useState("");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [config, setConfig] = useState<ChartConfig>({
    show_grid: true,
    show_legend: true,
    stack: false,
    bar_layout: "vertical",
  });

  useEffect(() => {
    if (chart) {
      setChartName(chart.name);
      setChartType(chart.chart_type);
      setConfig(chart.config ?? {});
    }
  }, [chart]);

  const columns = dataResult?.columns ?? [];

  function updateConfig(key: keyof ChartConfig, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    try {
      await updateChart.mutateAsync({
        name: chartName,
        chart_type: chartType,
        config,
      });
      toast.success("Chart updated!");
    } catch {
      toast.error("Failed to update chart");
    }
  }

  async function handleDelete() {
    try {
      await deleteChart.mutateAsync(id);
      toast.success("Chart deleted");
      router.push("/charts");
    } catch {
      toast.error("Failed to delete chart");
    }
  }

  if (chartLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!chart) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Chart not found
      </div>
    );
  }

  const isPieType = chartType === "pie" || chartType === "donut";
  const isKpi = chartType === "kpi";

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground"
              onClick={() => router.push("/charts")}
            >
              Charts
            </span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="truncate text-foreground">{chart.name}</span>
          </div>
        </div>

        {/* Dataset info */}
        {dataset && (
          <div className="border-b px-4 py-3">
            <p className="text-xs text-muted-foreground">Dataset</p>
            <p className="truncate text-sm font-medium">{dataset.name}</p>
            <p className="mt-1 line-clamp-2 font-mono text-[10px] text-muted-foreground">
              {dataset.sql}
            </p>
          </div>
        )}

        {/* Chart type */}
        <div className="border-b px-4 py-3">
          <Label className="mb-2 block text-xs text-muted-foreground">
            Chart Type
          </Label>
          <div className="grid grid-cols-2 gap-1.5">
            {CHART_TYPES.map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors",
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
          <div className="border-b px-4 py-3 space-y-3">
            {!isPieType && (
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">X Axis</Label>
                <Select
                  value={config.x_column ?? ""}
                  onValueChange={(v) => updateConfig("x_column", v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Column…" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isPieType ? (
              <>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Label</Label>
                  <Select value={config.label_column ?? ""} onValueChange={(v) => updateConfig("label_column", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Column…" /></SelectTrigger>
                    <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Value</Label>
                  <Select value={config.value_column ?? ""} onValueChange={(v) => updateConfig("value_column", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Column…" /></SelectTrigger>
                    <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Y Columns</Label>
                <div className="flex flex-wrap gap-1">
                  {columns.filter((c) => c !== config.x_column).map((c) => {
                    const selected = config.y_columns?.includes(c) ?? false;
                    return (
                      <button
                        key={c}
                        onClick={() => {
                          const prev = config.y_columns ?? [];
                          updateConfig("y_columns", selected ? prev.filter((x) => x !== c) : [...prev, c]);
                        }}
                        className={cn(
                          "rounded border px-2 py-0.5 text-xs",
                          selected ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
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

        {/* Options */}
        {!isPieType && !isKpi && (
          <div className="border-b px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Show grid</Label>
              <Switch checked={config.show_grid ?? true} onCheckedChange={(v) => updateConfig("show_grid", v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Show legend</Label>
              <Switch checked={config.show_legend ?? true} onCheckedChange={(v) => updateConfig("show_legend", v)} />
            </div>
            {(chartType === "bar" || chartType === "area") && (
              <div className="flex items-center justify-between">
                <Label className="text-xs">Stack series</Label>
                <Switch checked={config.stack ?? false} onCheckedChange={(v) => updateConfig("stack", v)} />
              </div>
            )}
          </div>
        )}

        {/* Save/delete */}
        <div className="mt-auto border-t px-4 py-3 space-y-2">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Name</Label>
            <Input value={chartName} onChange={(e) => setChartName(e.target.value)} className="h-8 text-sm" />
          </div>
          <Button onClick={handleSave} disabled={updateChart.isPending} className="w-full" size="sm">
            {updateChart.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
            Save Changes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete Chart
          </Button>
          <AlertDialog open={deleteOpen} onOpenChange={(o: boolean) => setDeleteOpen(o)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete chart?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{chart.name}&quot;. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Chart preview */}
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        {dataLoading ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : dataResult && !dataResult.error ? (
          <div className="w-full max-w-3xl rounded-xl border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-base font-semibold">{chartName}</h2>
            <ChartRenderer
              chartType={chartType}
              config={config}
              columns={dataResult.columns}
              rows={dataResult.rows}
              height={400}
            />
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <BarChart2 className="mx-auto mb-3 h-16 w-16 opacity-20" />
            <p className="text-sm">
              {dataResult?.error ?? "No data available"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
