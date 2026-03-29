"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  BarChart3,
  CheckSquare,
  Circle,
  LineChart,
  Loader2,
  Plus,
  PieChart,
  Search,
  Table2,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCharts, useDeleteChart } from "@/lib/hooks/use-charts";
import type { Chart, ChartType } from "@/types/api";
import { cn } from "@/lib/utils";

const CHART_ICON: Record<ChartType, React.ReactNode> = {
  bar: <BarChart2 className="h-5 w-5" />,
  line: <LineChart className="h-5 w-5" />,
  area: <TrendingUp className="h-5 w-5" />,
  pie: <PieChart className="h-5 w-5" />,
  donut: <Circle className="h-5 w-5" />,
  kpi: <BarChart3 className="h-5 w-5" />,
  table: <Table2 className="h-5 w-5" />,
  scatter: <BarChart2 className="h-5 w-5" />,
  combo: <BarChart3 className="h-5 w-5" />,
  funnel: <TrendingUp className="h-5 w-5" />,
  heatmap: <Table2 className="h-5 w-5" />,
};

const CHART_COLORS: Record<ChartType, string> = {
  bar: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  line: "bg-green-500/10 text-green-600 dark:text-green-400",
  area: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  pie: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  donut: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  kpi: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  table: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  scatter: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  combo: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  funnel: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  heatmap: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ChartsPage() {
  const router = useRouter();
  const { data: charts = [], isLoading } = useCharts();
  const deleteChart = useDeleteChart();

  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filtered = charts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteChart.mutateAsync(id);
      toast.success("Chart deleted");
    } catch {
      toast.error("Failed to delete chart");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => deleteChart.mutateAsync(id)));
      toast.success(`${ids.length} chart${ids.length !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch {
      toast.error("Failed to delete some charts");
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Charts</h1>
            <p className="text-sm text-muted-foreground">
              {charts.length} saved chart{charts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectionMode ? (
              <>
                <div className="flex items-center gap-2 mr-2">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                    id="select-all-charts"
                  />
                  <label htmlFor="select-all-charts" className="text-sm text-muted-foreground cursor-pointer select-none">
                    {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
                  </label>
                </div>
                {selectedIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete {selectedIds.size}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={toggleSelectionMode}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={toggleSelectionMode} disabled={charts.length === 0}>
                  <CheckSquare className="mr-2 h-4 w-4" />
                  Select
                </Button>
                <Button onClick={() => router.push("/charts/builder")}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Chart
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search charts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-4 text-muted-foreground">
            <BarChart2 className="h-16 w-16 opacity-20" />
            {search ? (
              <p>No charts match &quot;{search}&quot;</p>
            ) : (
              <>
                <p className="text-base">No charts yet</p>
                <Button onClick={() => router.push("/charts/new")} variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first chart
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((chart) => (
              <ChartCard
                key={chart.id}
                chart={chart}
                onOpen={() => router.push(`/charts/${chart.id}`)}
                onDelete={() => setDeletingId(chart.id)}
                selectionMode={selectionMode}
                selected={selectedIds.has(chart.id)}
                onToggle={() => toggleItem(chart.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Single delete dialog */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={(o: boolean) => !o && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chart?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId && handleDelete(deletingId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !o && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} chart{selectedIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChartCard({
  chart,
  onOpen,
  onDelete,
  selectionMode,
  selected,
  onToggle,
}: {
  chart: Chart;
  onOpen: () => void;
  onDelete: () => void;
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary border-primary/50"
      )}
      onClick={selectionMode ? onToggle : onOpen}
    >
      {/* Checkbox in selection mode */}
      {selectionMode && (
        <div className="absolute left-3 top-3 z-10" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} />
        </div>
      )}

      {/* Icon */}
      <div
        className={cn(
          "mb-3 inline-flex rounded-lg p-2",
          selectionMode && "ml-6",
          CHART_COLORS[chart.chart_type]
        )}
      >
        {CHART_ICON[chart.chart_type]}
      </div>

      {/* Title */}
      <p className="truncate font-medium">{chart.name}</p>
      {chart.description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {chart.description}
        </p>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <Badge variant="secondary" className="text-[10px] capitalize">
          {chart.chart_type}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {formatDate(chart.created_at)}
        </span>
      </div>

      {/* Delete button — only in normal mode */}
      {!selectionMode && (
        <button
          className="absolute right-3 top-3 hidden rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
