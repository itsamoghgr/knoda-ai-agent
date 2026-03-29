"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BarChart2, ChevronDown, ChevronUp, Download, Plus, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNumeric(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return !isNaN(Number(value));
}

function formatNumber(value: unknown): string {
  const n = Number(value);
  if (isNaN(n)) return String(value);
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function exportCSV(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(",");
  const body = rows.map(r =>
    columns.map(c => {
      const v = r[c];
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(",")
  ).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Count-up animation for metric cards ──────────────────────────────────────

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const from = 0;
    function step(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      setValue(from + (target - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  rows,
}: {
  label: string;
  value: unknown;
  rows: Record<string, unknown>[];
}) {
  const numeric = isNumeric(value);
  const target  = numeric ? Number(value) : 0;
  const animated = useCountUp(target);

  // Try to detect a comparison column (second column named prev/last/compare/change)
  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const compKey = keys.find(k => /prev|last|prior|change|diff|pct/i.test(k) && k !== keys[0]);
  const compValue = compKey ? rows[0][compKey] : null;
  const isPositive = compValue !== null && Number(compValue) > 0;
  const isNegative = compValue !== null && Number(compValue) < 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
    >
      <Card className="border-border/60">
        <CardContent className="pt-6 pb-5 px-6">
          <p className="text-sm text-muted-foreground mb-1 truncate">{label}</p>
          <p className="text-4xl font-bold tracking-tight font-[family-name:var(--font-geist-sans)]">
            {numeric ? formatNumber(animated) : String(value ?? "")}
          </p>
          {compValue !== null && isNumeric(compValue) && (
            <div className={cn(
              "flex items-center gap-1 mt-2 text-sm font-medium",
              isPositive ? "text-emerald-500" : isNegative ? "text-destructive" : "text-muted-foreground",
            )}>
              {isPositive ? <TrendingUp className="h-4 w-4" /> : isNegative ? <TrendingDown className="h-4 w-4" /> : null}
              <span>{formatNumber(compValue)} vs prior period</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Data table ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

function DataTable({
  columns,
  rows,
  truncated,
  onCreateChart,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  onCreateChart?: () => void;
}) {
  const [showAll, setShowAll]   = useState(false);
  const [sortCol, setSortCol]   = useState<string | null>(null);
  const [sortAsc, setSortAsc]   = useState(true);

  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const comp = isNumeric(av) && isNumeric(bv)
          ? Number(av) - Number(bv)
          : String(av).localeCompare(String(bv));
        return sortAsc ? comp : -comp;
      })
    : rows;

  const visible = showAll ? sorted : sorted.slice(0, PAGE_SIZE);
  const hidden  = rows.length - PAGE_SIZE;

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
    >
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="px-4 py-3 flex-row items-center justify-between border-b border-border/40 space-y-0">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-sm font-medium">
              {rows.length}{truncated ? "+" : ""} row{rows.length !== 1 ? "s" : ""}
              <span className="text-muted-foreground font-normal"> · {columns.length} columns</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider delay={300}>
              {onCreateChart && (
                <Tooltip>
                  <TooltipTrigger render={
                    <Button variant="ghost" size="sm" className="h-7 px-2 gap-1.5 text-xs" onClick={onCreateChart}>
                      <Plus className="h-3 w-3" />
                      Create Chart
                    </Button>
                  } />
                  <TooltipContent>Visualize this data as a chart</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="sm" className="h-7 px-2 gap-1.5 text-xs" onClick={() => exportCSV(columns, rows)}>
                    <Download className="h-3 w-3" />
                    CSV
                  </Button>
                } />
                <TooltipContent>Download as CSV</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/40">
                  {columns.map(col => (
                    <TableHead
                      key={col}
                      onClick={() => toggleSort(col)}
                      className="cursor-pointer select-none whitespace-nowrap text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 h-9 hover:text-foreground transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        {col}
                        {sortCol === col && (
                          <span className="opacity-60">
                            {sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </span>
                        )}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row, i) => (
                  <TableRow
                    key={i}
                    className={cn(
                      "border-b border-border/30 last:border-0",
                      i % 2 === 1 && "bg-muted/25",
                    )}
                  >
                    {columns.map(col => {
                      const val = row[col];
                      const num = isNumeric(val);
                      return (
                        <TableCell key={col} className="px-4 py-2 text-sm whitespace-nowrap">
                          {val === null || val === undefined ? (
                            <span className="text-muted-foreground/40 italic text-xs">null</span>
                          ) : (
                            <span className={cn(num && "font-mono tabular-nums")}>
                              {num ? formatNumber(val) : String(val)}
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Show more */}
          {!showAll && hidden > 0 && (
            <div className="px-4 py-2.5 border-t border-border/30 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {PAGE_SIZE} of {rows.length}{truncated ? "+" : ""} rows
              </span>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAll(true)}>
                <ChevronDown className="h-3 w-3" />
                Show {Math.min(hidden, 990)} more
              </Button>
            </div>
          )}
          {showAll && rows.length > PAGE_SIZE && (
            <div className="px-4 py-2.5 border-t border-border/30">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAll(false)}>
                <ChevronUp className="h-3 w-3" />
                Collapse
              </Button>
            </div>
          )}
          {truncated && (
            <div className="px-4 py-2 border-t border-border/30">
              <Badge variant="secondary" className="text-[10px]">Showing first 100 rows · read-only</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ArtifactSkeleton() {
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-5 w-16 ml-auto rounded-full" />
      </div>
      <div className="p-4 space-y-2.5">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    </div>
  );
}

// ─── DataArtifact ─────────────────────────────────────────────────────────────

export type ArtifactType = "metric" | "table" | "skeleton" | "none";

export function detectArtifactType(
  rows: Record<string, unknown>[],
  columns: string[],
): ArtifactType {
  if (rows.length === 0 || columns.length === 0) return "none";
  if (rows.length === 1 && columns.length <= 2) return "metric";
  return "table";
}

interface DataArtifactProps {
  rows: Record<string, unknown>[];
  columns: string[];
  truncated: boolean;
  isStreaming: boolean;
  onCreateChart?: () => void;
  onAddToDashboard?: () => void;
}

export function DataArtifact({
  rows,
  columns,
  truncated,
  isStreaming,
  onCreateChart,
}: DataArtifactProps) {
  const type = detectArtifactType(rows, columns);

  // Show skeleton while streaming and no data yet
  if (isStreaming && type === "none") {
    return <ArtifactSkeleton />;
  }

  if (type === "none") return null;

  if (type === "metric") {
    const label = columns[0] ?? "Value";
    const value = rows[0][columns[0]];
    return <MetricCard label={label} value={value} rows={rows} />;
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      truncated={truncated}
      onCreateChart={onCreateChart}
    />
  );
}
