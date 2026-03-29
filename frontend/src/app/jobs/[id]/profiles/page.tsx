"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { BarChart3, KeyRound, Rows3, Ruler, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog, useSemanticLayer } from "@/lib/hooks/use-jobs";
import { TABLE_TYPE_STYLES } from "@/lib/theme";
import type { SemanticModel, TableMeta } from "@/types/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRows(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `~${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function StatRow({
  table,
  model,
  even,
}: {
  table: TableMeta;
  model: SemanticModel | undefined;
  even: boolean;
}) {
  const tableType = model?.table_type ?? "unknown";

  return (
    <div
      className={`grid grid-cols-[1fr_100px_80px_72px_72px_72px_80px] items-center gap-4 px-5 py-3 text-sm border-b last:border-0 ${
        even ? "bg-muted/20" : ""
      }`}
    >
      {/* Table name */}
      <div className="min-w-0">
        <p className="font-mono font-semibold truncate">{table.table_name}</p>
        <p className="text-[11px] text-muted-foreground font-mono truncate">{table.schema_name}</p>
      </div>

      {/* Table type */}
      <div>
        {model ? (
          <Badge
            className={`text-[10px] capitalize ${TABLE_TYPE_STYLES[tableType] ?? TABLE_TYPE_STYLES.unknown}`}
          >
            {tableType}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Columns */}
      <p className="tabular-nums text-right text-muted-foreground">{table.column_count}</p>

      {/* Est. rows */}
      <p className="tabular-nums text-right text-muted-foreground">{fmtRows(table.row_estimate ?? 0)}</p>

      {/* Entities */}
      <p className="tabular-nums text-right text-muted-foreground">{model?.entities.length ?? "—"}</p>

      {/* Dimensions */}
      <p className="tabular-nums text-right text-muted-foreground">{model?.dimensions.length ?? "—"}</p>

      {/* Measures */}
      <p className="tabular-nums text-right text-muted-foreground">{model?.measures.length ?? "—"}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilesPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const { data: tables, isLoading: tablesLoading } = useCatalog(jobId);
  const { data: models, isLoading: modelsLoading } = useSemanticLayer(jobId);

  const isLoading = tablesLoading || modelsLoading;

  // Build a lookup map: "schema.table" → SemanticModel
  const modelMap = useMemo(() => {
    const map = new Map<string, SemanticModel>();
    for (const m of models ?? []) {
      map.set(`${m.schema_name}.${m.table_name}`, m);
    }
    return map;
  }, [models]);

  // Summary stats
  const totalRows = useMemo(
    () => (tables ?? []).reduce((sum, t) => sum + (t.row_estimate ?? 0), 0),
    [tables],
  );
  const totalCols = useMemo(
    () => (tables ?? []).reduce((sum, t) => sum + t.column_count, 0),
    [tables],
  );
  const factCount      = (models ?? []).filter((m) => m.table_type === "fact").length;
  const dimensionCount = (models ?? []).filter((m) => m.table_type === "dimension").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Table Stats</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Schema metadata — row estimates and column counts from the DuckDB catalog.
        </p>
      </div>

      {/* Summary cards */}
      {!isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Table2,    label: "Tables",     value: tables?.length ?? 0 },
            { icon: Rows3,     label: "Total cols",  value: totalCols },
            { icon: BarChart3, label: "Est. rows",  value: fmtRows(totalRows) },
            { icon: KeyRound,  label: "Fact / Dim", value: `${factCount} / ${dimensionCount}` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-4 rounded-xl border bg-card px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : !tables?.length ? (
        <p className="text-sm text-muted-foreground">No tables found.</p>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_100px_80px_72px_72px_72px_80px] gap-4 px-5 py-2.5 text-xs font-semibold text-muted-foreground bg-muted/40 border-b">
            <span>Table</span>
            <span>Type</span>
            <span className="text-right">Columns</span>
            <span className="text-right">Est. rows</span>
            <span className="flex items-center justify-end gap-1">
              <KeyRound className="h-3 w-3" /> Ent.
            </span>
            <span className="flex items-center justify-end gap-1">
              <Ruler className="h-3 w-3" /> Dim.
            </span>
            <span className="flex items-center justify-end gap-1">
              <BarChart3 className="h-3 w-3" /> Meas.
            </span>
          </div>

          {/* Rows */}
          {tables.map((table, i) => (
            <StatRow
              key={`${table.schema_name}.${table.table_name}`}
              table={table}
              model={modelMap.get(`${table.schema_name}.${table.table_name}`)}
              even={i % 2 === 0}
            />
          ))}
        </div>
      )}

      {/* Note */}
      <p className="text-xs text-muted-foreground">
        Row counts are estimates from the DuckDB catalog — no table scans are performed.
        For exact counts or column distributions, use the{" "}
        <span className="font-medium">AI chat</span>.
      </p>
    </div>
  );
}
