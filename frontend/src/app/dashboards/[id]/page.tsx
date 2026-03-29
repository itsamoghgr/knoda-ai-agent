"use client";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  BarChart2,
  ChevronRight,
  Copy,
  Download,
  LayoutGrid,
  Loader2,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  useDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useCharts,
  useAddChartToDashboard,
  useRemoveChartFromDashboard,
  useUpdateDashboardLayout,
  useRefreshDashboard,
} from "@/lib/hooks/use-charts";
import ChartRenderer from "@/components/charts/ChartRenderer";
import { DashboardFilterProvider, useDashboardFilters } from "@/components/charts/dashboard-filter-context";
import { DashboardFilterBar } from "@/components/charts/DashboardFilterBar";
import type { DashboardChart } from "@/types/api";

// Dynamic import of plain ReactGridLayout (no WidthProvider — we measure width ourselves)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridLayout: any = dynamic(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("react-grid-layout")) as any;
    return { default: mod.default ?? mod };
  },
  { ssr: false }
);

const GAP = 6; // px — gap between tiles AND outer padding (containerPadding on GridLayout)
const MIN_ROW_HEIGHT = 100;
const TARGET_ROWS_VISIBLE = 4; // aim to show ~4 grid-unit rows in the viewport

// ─── Grid layout helpers ───────────────────────────────────────────────────────

/** Default grid size per chart type (w in 12-col units, h in row units). */
function defaultChartSize(chartType: string): { w: number; h: number } {
  if (chartType === "kpi") return { w: 4, h: 2 };
  if (chartType === "table") return { w: 12, h: 3 };
  if (chartType === "pie" || chartType === "donut") return { w: 6, h: 2 };
  return { w: 6, h: 2 }; // bar, line, area
}

/**
 * Smart column-packing: if there is room on the last occupied row, place
 * the new chart there; otherwise start a fresh row.
 *
 * Filter by starting Y (not bottom edge) so mixed-height charts on the same
 * row are all counted when computing used columns.
 */
function nextAvailablePosition(
  layoutMap: Record<string, { x: number; y: number; w: number; h: number }>,
  newW: number,
): { x: number; y: number } {
  const items = Object.values(layoutMap);
  if (items.length === 0) return { x: 0, y: 0 };

  const maxY = Math.max(...items.map((l) => l.y));
  const lastRowItems = items.filter((l) => l.y === maxY);
  const usedCols = lastRowItems.reduce((sum, l) => sum + l.w, 0);

  if (usedCols + newW <= 12) {
    return { x: usedCols, y: maxY };
  }
  const maxBottom = Math.max(...items.map((l) => l.y + l.h));
  return { x: 0, y: maxBottom };
}

/**
 * Compute the optimal chart width given the total number of non-table charts.
 * Targets 2 visual rows so rowHeight stays large and charts look good.
 *   3 charts → 2/row  → w=6
 *   5 charts → 3/row  → w=4
 *   7 charts → 4/row  → w=4 (min enforced)
 */
function optimalChartWidth(nonTableCount: number): number {
  if (nonTableCount <= 0) return 6;
  const chartsPerRow = Math.ceil(nonTableCount / 2);
  return Math.max(4, Math.floor(12 / chartsPerRow));
}

/**
 * Re-sort and pack all charts into a clean grid layout.
 * Uses a count-aware width so charts fill 2 rows whenever possible,
 * keeping rowHeight large enough for labels and data to render clearly.
 * Sort order: KPIs → pie/donut → bar/line/area → tables.
 */
function autoArrange(
  charts: DashboardChart[],
): Record<string, { x: number; y: number; w: number; h: number }> {
  const order: Record<string, number> = {
    kpi: 0,
    pie: 1,
    donut: 1,
    bar: 2,
    line: 2,
    area: 2,
    table: 3,
  };
  const sorted = [...charts].sort(
    (a, b) => (order[a.chart_type] ?? 2) - (order[b.chart_type] ?? 2),
  );

  // Compute optimal width based on non-table chart count
  const nonTableCount = charts.filter((c) => c.chart_type !== "table").length;
  const optW = optimalChartWidth(nonTableCount);

  const newLayout: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const chart of sorted) {
    const { h } = defaultChartSize(chart.chart_type);
    // Tables always span full width; all other chart types use the computed optW
    const w = chart.chart_type === "table" ? 12 : optW;
    const pos = nextAvailablePosition(newLayout, w);
    newLayout[chart.chart_id] = { x: pos.x, y: pos.y, w, h };
  }

  // Fill-row pass: expand the rightmost chart in each incomplete row to fill 12 columns.
  const rowIds: Record<number, string[]> = {};
  for (const [id, pos] of Object.entries(newLayout)) {
    rowIds[pos.y] = [...(rowIds[pos.y] ?? []), id];
  }
  for (const ids of Object.values(rowIds)) {
    const usedW = ids.reduce((sum, id) => sum + newLayout[id].w, 0);
    if (usedW < 12) {
      const rightmost = ids.reduce((best, id) =>
        newLayout[id].x > newLayout[best].x ? id : best,
      );
      newLayout[rightmost] = {
        ...newLayout[rightmost],
        w: newLayout[rightmost].w + (12 - usedW),
      };
    }
  }

  return newLayout;
}

// ─── Chart widget ─────────────────────────────────────────────────────────────

function ChartWidget({
  dc,
  editMode,
  onRemove,
}: {
  dc: DashboardChart;
  editMode: boolean;
  onRemove: () => void;
}) {
  const snap = dc.snapshot;
  const { setFilter, applyFilters } = useDashboardFilters();
  const [refreshing, setRefreshing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(0);

  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (h > 0) setChartHeight(h);
    const obs = new ResizeObserver(([entry]) => {
      const ch = entry.contentRect.height;
      if (ch > 0) setChartHeight(ch);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Stale data indicator — amber dot if > 24h
  const isStale = snap?.cached_at
    ? Date.now() - new Date(snap.cached_at).getTime() > 24 * 60 * 60 * 1000
    : false;

  // Short cached time label (shown in Refresh button tooltip)
  const cachedLabel = snap?.cached_at
    ? `Cached ${new Date(snap.cached_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "No data";

  function handleDownloadCSV() {
    if (!snap?.rows.length) return;
    const cols = snap.columns;
    const header = cols.join(",");
    const body = snap.rows
      .map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${dc.chart_name}.csv`;
    a.click();
    toast.success("CSV downloaded");
  }

  return (
    <>
      <div
        className={`group relative flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors ${
          editMode ? "border-primary/30 cursor-grab active:cursor-grabbing" : "border-border/40"
        }`}
      >
        {/* Title bar */}
        <div className="flex shrink-0 items-center justify-between px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isStale && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                title="Data may be stale (>24h)"
              />
            )}
            <span className="truncate text-xs font-medium text-muted-foreground">
              {dc.chart_name}
            </span>
          </div>

          {/* Hover action buttons — fade in on group hover */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => {
                setRefreshing(true);
                setTimeout(() => setRefreshing(false), 1500);
              }}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={cachedLabel}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              onClick={() => setFullscreen(true)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Expand"
            >
              <Maximize2 className="h-3 w-3" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <MoreHorizontal className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => {
                    setRefreshing(true);
                    setTimeout(() => setRefreshing(false), 1500);
                  }}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFullscreen(true)}>
                  <Maximize2 className="mr-2 h-3.5 w-3.5" /> Expand
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleDownloadCSV} disabled={!snap?.rows.length}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Download CSV
                </DropdownMenuItem>
                {editMode && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onRemove}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {editMode && (
              <button
                onClick={onRemove}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Chart area */}
        <div ref={chartAreaRef} className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          {snap?.error ? (
            <div className="flex flex-1 items-center justify-center text-xs text-destructive">
              {snap.error}
            </div>
          ) : snap && snap.columns.length > 0 && chartHeight > 0 ? (
            <ChartRenderer
              chartType={dc.chart_type}
              config={dc.config ?? {}}
              columns={snap.columns}
              rows={applyFilters(snap.rows, dc.chart_id)}
              height={chartHeight}
              loading={refreshing}
              onDataPointClick={(dimension, value) =>
                setFilter({ dimension, value, sourceChartId: dc.chart_id })
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              No data — click Refresh All
            </div>
          )}
        </div>
      </div>

      {/* Full-screen dialog */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-3">
            <DialogTitle className="text-sm font-medium">{dc.chart_name}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-4">
            {snap && snap.columns.length > 0 ? (
              <ChartRenderer
                chartType={dc.chart_type}
                config={dc.config ?? {}}
                columns={snap.columns}
                rows={snap.rows}
                height="100%"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No data
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Bot mode dashboard ───────────────────────────────────────────────────────

function BotModeDashboard({ dashboard }: { dashboard: import("@/types/api").DashboardDetail }) {
  // Sort by grid position (top→bottom, left→right), tables always last
  const sortedCharts = [...dashboard.charts].sort((a, b) => {
    const aIsTable = a.chart_type === "table" ? 1 : 0;
    const bIsTable = b.chart_type === "table" ? 1 : 0;
    if (aIsTable !== bIsTable) return aIsTable - bIsTable;
    if (a.grid_y !== b.grid_y) return a.grid_y - b.grid_y;
    return a.grid_x - b.grid_x;
  });

  const chartCount = sortedCharts.length;
  const cols = chartCount <= 2 ? 1 : chartCount <= 4 ? 2 : 3;

  const nonTableCount = sortedCharts.filter((dc) => dc.chart_type !== "table").length;
  const tableCount = sortedCharts.filter((dc) => dc.chart_type === "table").length;
  const nonTableRows = Math.ceil(nonTableCount / cols);
  const totalRows = nonTableRows + tableCount;

  // Viewport is always 1280×1080 (set in screenshare.py).
  // Compute exact pixel heights so ECharts never initialises into a 0-size canvas.
  const VIEWPORT_H = 1080;
  const PADDING = 32;    // p-4 top + bottom
  const HEADER_H = 44;   // h1 + mb-3
  const GAP = 12;        // gap-3
  const TITLE_H = 20;    // chart label line

  const availableH = VIEWPORT_H - PADDING - HEADER_H;
  const rowH = Math.floor((availableH - GAP * (totalRows - 1)) / totalRows);
  const chartH = Math.max(rowH - TITLE_H - 24, 60); // 24 = card padding top+bottom

  const gridColsClass = cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3";
  const rowStyle = `${rowH}px`;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background p-4">
      <h1 className="mb-3 shrink-0 text-lg font-semibold text-foreground">{dashboard.name}</h1>
      <div
        className={`grid ${gridColsClass} gap-3`}
        style={{ gridAutoRows: rowStyle }}
      >
        {sortedCharts.map((dc) => (
          <div
            key={dc.chart_id}
            className={`echarts-instance flex flex-col overflow-hidden rounded-lg border bg-card p-3${dc.chart_type === "table" ? " col-span-full" : ""}`}
          >
            <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">{dc.chart_name}</p>
            {dc.snapshot ? (
              <ChartRenderer
                chartType={dc.chart_type as Parameters<typeof ChartRenderer>[0]["chartType"]}
                config={dc.config}
                columns={dc.snapshot.columns}
                rows={dc.snapshot.rows}
                height={chartH}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                No data
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBotMode = searchParams.get("bot") === "1";

  const { data: dashboard, isLoading } = useDashboard(id);
  const updateDashboard = useUpdateDashboard(id);
  const deleteDashboard = useDeleteDashboard();
  const addChart = useAddChartToDashboard(id);
  const removeChart = useRemoveChartFromDashboard(id);
  const updateLayout = useUpdateDashboardLayout(id);
  const refreshDashboard = useRefreshDashboard(id);

  const { data: allCharts = [] } = useCharts();

  const [editMode, setEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [layoutMap, setLayoutMap] = useState<
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});
  const [gridWidth, setGridWidth] = useState(1200);
  const [containerHeight, setContainerHeight] = useState(600);

  // Measure grid container for both width (GridLayout) and height (dynamic rowHeight).
  // We use the content-box dimensions (excluding padding) to be consistent with
  // ResizeObserver's contentRect — getBoundingClientRect includes padding and would
  // cause the initial rowHeight to be too large, clipping the last chart row.
  const gridContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const ph = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const pv = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    setGridWidth((el.clientWidth - ph) || 1200);
    setContainerHeight((el.clientHeight - pv) || 600);
    const obs = new ResizeObserver(([entry]) => {
      setGridWidth(entry.contentRect.width);
      setContainerHeight(entry.contentRect.height);
    });
    obs.observe(el);
    // cleanup handled by GC when component unmounts
  }, []);

  // Sync layout from dashboard data
  useEffect(() => {
    if (!dashboard) return;
    const map: Record<string, { x: number; y: number; w: number; h: number }> =
      {};
    for (const dc of dashboard.charts) {
      map[dc.chart_id] = {
        x: dc.grid_x,
        y: dc.grid_y,
        w: dc.grid_w,
        h: dc.grid_h,
      };
    }
    setLayoutMap(map);
  }, [dashboard]);

  const gridLayout = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.charts.map((dc) => {
      const pos = layoutMap[dc.chart_id];
      return {
        i: dc.chart_id,
        x: pos?.x ?? dc.grid_x,
        y: pos?.y ?? dc.grid_y,
        w: pos?.w ?? dc.grid_w,
        h: pos?.h ?? dc.grid_h,
        minW: 2,
        minH: 1,
      };
    });
  }, [dashboard, layoutMap]);

  // rowHeight: divide the available space by a fixed target row count.
  // This is the same approach Grafana/Metabase use — choose a height
  // that makes charts readable on any screen, rather than trying to
  // pack all rows into the viewport via brittle pixel math.
  //
  // targetRows = how many grid-unit rows should fill the screen.
  // For a 2-row dashboard (e.g. 3 KPIs + 3 bar charts) that's perfect; for a
  // 4-row dashboard, the last row is just slightly below the fold (scroll).
  //
  // Formula: available = containerHeight - (TARGET_ROWS_VISIBLE+1)*GAP
  //          rowHeight = available / TARGET_ROWS_VISIBLE
  const rowHeight = useMemo(() => {
    const spacing = (TARGET_ROWS_VISIBLE + 1) * GAP;
    const available = containerHeight - spacing;
    return Math.max(MIN_ROW_HEIGHT, Math.floor(available / TARGET_ROWS_VISIBLE));
  }, [containerHeight]);

  const existingChartIds = new Set(dashboard?.charts.map((dc) => dc.chart_id));
  const availableCharts = allCharts.filter((c) => !existingChartIds.has(c.id));

  async function handleAddChart(chartId: string) {
    const chart = allCharts.find((c) => c.id === chartId);
    const chartType = chart?.chart_type ?? "bar";
    const { h } = defaultChartSize(chartType);

    // Compute the same optimal width used by autoArrange, accounting for the new chart
    const currentNonTableCount = (dashboard?.charts ?? []).filter(
      (dc) => dc.chart_type !== "table",
    ).length;
    const newNonTableCount =
      chartType === "table" ? currentNonTableCount : currentNonTableCount + 1;
    const w = chartType === "table" ? 12 : optimalChartWidth(newNonTableCount);

    const { x, y } = nextAvailablePosition(layoutMap, w);
    try {
      await addChart.mutateAsync({
        chart_id: chartId,
        grid_x: x,
        grid_y: y,
        grid_w: w,
        grid_h: h,
      });
      setAddOpen(false);
      toast.success("Chart added to dashboard");
    } catch {
      toast.error("Failed to add chart");
    }
  }

  async function handleRemoveChart(chartId: string) {
    try {
      await removeChart.mutateAsync(chartId);
      toast.success("Chart removed");
    } catch {
      toast.error("Failed to remove chart");
    }
  }

  async function handleSaveLayout() {
    const layout = Object.entries(layoutMap).map(([chart_id, pos]) => ({
      chart_id,
      grid_x: pos.x,
      grid_y: pos.y,
      grid_w: pos.w,
      grid_h: pos.h,
    }));
    try {
      await updateLayout.mutateAsync(layout);
      setEditMode(false);
      toast.success("Layout saved");
    } catch {
      toast.error("Failed to save layout");
    }
  }

  async function handleDelete() {
    try {
      await deleteDashboard.mutateAsync(id);
      toast.success("Dashboard deleted");
      router.push("/dashboards");
    } catch {
      toast.error("Failed to delete dashboard");
    }
  }

  async function handleAutoArrange() {
    if (!dashboard?.charts.length) return;
    const newLayout = autoArrange(dashboard.charts);
    setLayoutMap(newLayout);
    const layout = Object.entries(newLayout).map(([chart_id, pos]) => ({
      chart_id,
      grid_x: pos.x,
      grid_y: pos.y,
      grid_w: pos.w,
      grid_h: pos.h,
    }));
    try {
      await updateLayout.mutateAsync(layout);
      toast.success("Layout auto-arranged and saved");
    } catch {
      toast.error("Failed to save auto-arranged layout");
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Dashboard not found
      </div>
    );
  }

  // Bot mode: stripped-down fullscreen view for Recall.ai screenshare
  if (isBotMode) {
    return <BotModeDashboard dashboard={dashboard} />;
  }

  return (
    <DashboardFilterProvider>
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground"
              onClick={() => router.push("/dashboards")}
            >
              Dashboards
            </span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{dashboard.name}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
            {editMode ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Chart
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveLayout}
                  disabled={updateLayout.isPending}
                >
                  {updateLayout.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save Layout
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditMode(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAutoArrange}
                  disabled={updateLayout.isPending || !dashboard?.charts.length}
                >
                  {updateLayout.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Auto-arrange
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refreshDashboard.mutate()}
                  disabled={refreshDashboard.isPending || !dashboard?.charts.length}
                >
                  {refreshDashboard.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Refresh All
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => router.push(`/dashboards/${id}/present`)}
                  disabled={!dashboard?.charts.length}
                >
                  <Presentation className="mr-1.5 h-3.5 w-3.5" />
                  Present
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditMode(true)}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
        {dashboard.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboard.description}
          </p>
        )}
        {editMode && (
          <p className="mt-1 text-xs text-muted-foreground">
            Drag to move · Resize from the corner · Click × to remove
          </p>
        )}
      </div>

      {/* Active cross-filter bar — only visible when filters are active */}
      <DashboardFilterBar />

      {/* Grid — flex-1 fills remaining height. overflow-y-auto: content fills viewport for ~4 grid rows;
           dashboards with more rows scroll gracefully (Grafana/Metabase model). */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/20 [scrollbar-width:thin]"
        ref={gridContainerRef}
      >
        {dashboard.charts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="rounded-2xl border border-dashed border-border/60 bg-card p-10 text-center max-w-sm">
              <BarChart2 className="mx-auto h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium mb-1">This dashboard is empty</p>
              <p className="text-xs text-muted-foreground mb-4">
                Add your first chart, or ask your AI analyst
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="default" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Chart
                </Button>
                <Button variant="outline" size="sm" onClick={() => router.push("/chat")}>
                  <MessageSquareText className="mr-1.5 h-3.5 w-3.5" /> Ask AI
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={gridLayout}
            cols={12}
            rowHeight={rowHeight}
            width={gridWidth}
            isDraggable={editMode}
            isResizable={editMode}
            onLayoutChange={(layout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
              const newMap: typeof layoutMap = {};
              for (const item of layout) {
                newMap[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
              }
              setLayoutMap(newMap);
            }}
            margin={[GAP, GAP]}
            containerPadding={[GAP, GAP]}
          >
            {dashboard.charts.map((dc) => (
              <div key={dc.chart_id}>
                <ChartWidget
                  dc={dc}
                  editMode={editMode}
                  onRemove={() => handleRemoveChart(dc.chart_id)}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {/* Add chart dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Chart to Dashboard</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {availableCharts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                All saved charts are already on this dashboard.{" "}
                <span
                  className="cursor-pointer text-primary underline"
                  onClick={() => router.push("/charts/new")}
                >
                  Create a new chart
                </span>
              </p>
            ) : (
              availableCharts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleAddChart(c.id)}
                  className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left hover:bg-muted transition-colors"
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {c.chart_type}
                  </Badge>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dashboard?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{dashboard.name}&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </DashboardFilterProvider>
  );
}
