"use client";

import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { EChartsOption } from "echarts";
import type { ChartConfig, ChartType } from "@/types/api";
import { CHART_PALETTE } from "@/lib/echarts-theme";
import EChartsBase from "./EChartsBase";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ChartRendererProps {
  chartType: ChartType;
  config: ChartConfig;
  columns: string[];
  rows: Record<string, unknown>[];
  height?: number | string;
  loading?: boolean;
  onDataPointClick?: (dimension: string, value: unknown) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" && isNaN(Number(value))) return String(value ?? "—");
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ─── KPI tile ─────────────────────────────────────────────────────────────────

function KpiRenderer({ config, rows, columns }: { config: ChartConfig; rows: Record<string, unknown>[]; columns: string[] }) {
  const valueCol = config.value_column ?? columns.find((c) => typeof rows[0]?.[c] === "number") ?? columns[0] ?? "";
  const labelCol = config.label_column ?? valueCol;
  const rawValue = rows[0]?.[valueCol];
  const formatted = formatNumber(rawValue);
  const label = str(rows[0]?.[labelCol] ?? valueCol);

  // Delta — if two rows, treat as [current, previous]
  const hasDelta = rows.length >= 2;
  const current = num(rawValue);
  const previous = hasDelta ? num(rows[1]?.[valueCol]) : null;
  const delta = hasDelta && previous !== null && previous !== 0
    ? ((current - previous) / Math.abs(previous)) * 100
    : null;

  // Mini sparkline option (no axes, no grid, just trend shape)
  const sparkOption: EChartsOption | null = rows.length > 2 ? {
    series: [{
      type: "line",
      data: rows.map((r) => num(r[valueCol])),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: CHART_PALETTE[0] },
      areaStyle: { opacity: 0.08, color: CHART_PALETTE[0] },
    }],
    grid: { top: 0, bottom: 0, left: 0, right: 0 },
    xAxis: { show: false, type: "category", data: rows.map((_, i) => i) },
    yAxis: { show: false, type: "value" },
    animation: false,
  } : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate max-w-full">
        {label}
      </span>
      <span className="text-4xl font-bold tabular-nums leading-tight">{formatted}</span>

      {delta !== null && (
        <div className={`flex items-center gap-1 text-xs font-medium ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-rose-500" : "text-muted-foreground"}`}>
          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          <span>{delta > 0 ? "+" : ""}{delta.toFixed(1)}%</span>
        </div>
      )}

      {sparkOption && (
        <div className="w-full mt-1" style={{ height: 32 }}>
          <EChartsBase option={sparkOption} height={32} />
        </div>
      )}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

function TableRenderer({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const cols = columns.length ? columns : rows[0] ? Object.keys(rows[0]) : [];
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter((r) => cols.some((c) => str(r[c]).toLowerCase().includes(q)));
    }
    if (sortCol) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        const cmp = typeof av === "number" && typeof bv === "number"
          ? av - bv : str(av).localeCompare(str(bv));
        return sortDesc ? -cmp : cmp;
      });
    }
    return data;
  }, [rows, cols, search, sortCol, sortDesc]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function handleSort(col: string) {
    if (sortCol === col) setSortDesc((d) => !d);
    else { setSortCol(col); setSortDesc(false); }
  }

  function downloadCSV() {
    const header = cols.join(",");
    const body = rows.map((r) => cols.map((c) => JSON.stringify(str(r[c]))).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "data.csv";
    a.click();
  }

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <input
          className="h-6 rounded border border-border bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-primary/40"
          placeholder="Search…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <button onClick={downloadCSV} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Export CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  onClick={() => handleSort(c)}
                  className="cursor-pointer select-none border-b px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  {c} {sortCol === c ? (sortDesc ? "↓" : "↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, ri) => (
              <tr key={ri} className="border-b border-border/40 hover:bg-muted/30">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-1.5 font-mono tabular-nums">
                    {row[c] != null ? str(row[c]) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between px-1 text-xs text-muted-foreground">
          <span>{filtered.length} rows</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40 hover:text-foreground">←</button>
            <span>{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40 hover:text-foreground">→</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ECharts option builders ──────────────────────────────────────────────────

function grid(hasLegend: boolean) {
  return { left: "5%", right: "3%", top: 12, bottom: hasLegend ? 50 : 28, containLabel: true };
}

function legend(yCols: string[], show: boolean): EChartsOption["legend"] {
  return show && yCols.length > 1 ? { bottom: 0, type: "scroll", textStyle: { fontSize: 11 } } : undefined;
}

function barOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[]): EChartsOption {
  const xCol = config.x_column ?? columns[0] ?? "";
  const yCols = config.y_columns?.length ? config.y_columns : columns.filter((c) => c !== xCol).slice(0, 6);
  const isH = config.bar_layout === "horizontal";
  const showLeg = (config.show_legend ?? true) && yCols.length > 1;
  const cats = rows.map((r) => str(r[xCol]));

  return {
    tooltip: { trigger: "axis" },
    legend: legend(yCols, showLeg),
    grid: grid(showLeg),
    xAxis: isH ? { type: "value" } : { type: "category", data: cats, axisLabel: { rotate: cats.length > 10 ? 30 : 0, hideOverlap: true } },
    yAxis: isH ? { type: "category", data: cats, axisLabel: { width: 100, overflow: "truncate" } } : { type: "value" },
    series: yCols.map((y, i) => ({
      name: y, type: "bar",
      data: rows.map((r) => num(r[y])),
      stack: config.stack ? "total" : undefined,
      color: CHART_PALETTE[i % CHART_PALETTE.length],
      itemStyle: { borderRadius: isH ? [0, 3, 3, 0] : [3, 3, 0, 0] },
      emphasis: { focus: "series" },
    })),
  };
}

function lineOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[], isArea = false): EChartsOption {
  const xCol = config.x_column ?? columns[0] ?? "";
  const yCols = config.y_columns?.length ? config.y_columns : columns.filter((c) => c !== xCol).slice(0, 6);
  const showLeg = (config.show_legend ?? true) && yCols.length > 1;

  return {
    tooltip: { trigger: "axis" },
    legend: legend(yCols, showLeg),
    grid: grid(showLeg),
    dataZoom: [{ type: "inside" }],
    xAxis: { type: "category", data: rows.map((r) => str(r[xCol])), axisLabel: { hideOverlap: true } },
    yAxis: { type: "value" },
    series: yCols.map((y, i) => ({
      name: y, type: "line", smooth: true,
      data: rows.map((r) => num(r[y])),
      stack: isArea && config.stack ? "total" : undefined,
      areaStyle: isArea ? { opacity: 0.12, color: CHART_PALETTE[i % CHART_PALETTE.length] } : undefined,
      showSymbol: rows.length < 50,
      color: CHART_PALETTE[i % CHART_PALETTE.length],
      emphasis: { focus: "series" },
    })),
  };
}

function pieOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[], isDonut = false): EChartsOption {
  const xCol = config.x_column ?? columns[0] ?? "";
  const yCols = config.y_columns?.length ? config.y_columns : columns.filter((c) => c !== xCol);
  const nameKey = config.label_column ?? xCol;
  const valueKey = config.value_column ?? yCols[0] ?? "";
  const showLeg = config.show_legend ?? true;

  // Group tail slices as "Other" if >8 slices
  let data = rows.map((r) => ({ name: str(r[nameKey]), value: num(r[valueKey]) }))
    .sort((a, b) => b.value - a.value);
  if (data.length > 8) {
    const top = data.slice(0, 7);
    const rest = data.slice(7).reduce((s, d) => s + d.value, 0);
    data = [...top, { name: "Other", value: rest }];
  }

  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: showLeg ? { orient: "horizontal", bottom: 0, type: "scroll" } : undefined,
    series: [{
      type: "pie",
      radius: isDonut ? ["40%", "68%"] : "68%",
      center: ["50%", showLeg ? "44%" : "50%"],
      data,
      label: { show: data.length <= 6, fontSize: 11 },
      emphasis: { itemStyle: { shadowBlur: 10 }, scale: true, scaleSize: 4 },
      animationType: "scale",
    }],
  };
}

function scatterOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[]): EChartsOption {
  const xCol = config.x_column ?? columns[0] ?? "";
  const yCol = (config.y_columns ?? [])[0] ?? columns[1] ?? "";
  const colorCol = config.series_column ?? null;

  if (!colorCol) {
    return {
      tooltip: { trigger: "item", formatter: (p: unknown) => {
        const params = p as { value: number[] };
        return `${xCol}: ${params.value[0]}<br/>${yCol}: ${params.value[1]}`;
      }},
      grid: grid(false),
      xAxis: { type: "value", name: xCol },
      yAxis: { type: "value", name: yCol },
      series: [{ type: "scatter", data: rows.map((r) => [num(r[xCol]), num(r[yCol])]), symbolSize: 8, color: CHART_PALETTE[0] }],
    };
  }

  // Color-coded by dimension
  const groups: Record<string, number[][]> = {};
  for (const r of rows) {
    const key = str(r[colorCol]);
    if (!groups[key]) groups[key] = [];
    groups[key].push([num(r[xCol]), num(r[yCol])]);
  }

  return {
    tooltip: { trigger: "item" },
    legend: { bottom: 0, type: "scroll" },
    grid: grid(true),
    xAxis: { type: "value", name: xCol },
    yAxis: { type: "value", name: yCol },
    series: Object.entries(groups).map(([name, data], i) => ({
      name, type: "scatter", data, symbolSize: 8, color: CHART_PALETTE[i % CHART_PALETTE.length],
    })),
  };
}

function comboOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[]): EChartsOption {
  const xCol = config.x_column ?? columns[0] ?? "";
  const yCols = config.y_columns?.length ? config.y_columns : columns.filter((c) => c !== xCol).slice(0, 4);
  const cats = rows.map((r) => str(r[xCol]));
  const showLeg = yCols.length > 1;

  return {
    tooltip: { trigger: "axis" },
    legend: legend(yCols, showLeg),
    grid: grid(showLeg),
    xAxis: { type: "category", data: cats },
    yAxis: [{ type: "value", name: yCols[0] }, { type: "value", name: yCols[1] ?? "", position: "right" }],
    series: yCols.map((y, i) => ({
      name: y,
      type: i === 0 ? "bar" : "line",
      yAxisIndex: i === 0 ? 0 : 1,
      data: rows.map((r) => num(r[y])),
      color: CHART_PALETTE[i % CHART_PALETTE.length],
      ...(i === 0 ? { itemStyle: { borderRadius: [3, 3, 0, 0] } } : { smooth: true, showSymbol: false }),
    })),
  };
}

function funnelOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[]): EChartsOption {
  const nameCol = config.label_column ?? config.x_column ?? columns[0] ?? "";
  const valueCol = config.value_column ?? (config.y_columns ?? [])[0] ?? columns[1] ?? "";

  return {
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    series: [{
      type: "funnel",
      left: "10%", width: "80%", top: 20, bottom: 20,
      data: rows.map((r, i) => ({ name: str(r[nameCol]), value: num(r[valueCol]), itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] } })),
      label: { position: "inside", fontSize: 11 },
      emphasis: { label: { fontSize: 13 } },
    }],
  };
}

function heatmapOption(config: ChartConfig, columns: string[], rows: Record<string, unknown>[]): EChartsOption {
  const xCol = config.x_column ?? columns[0] ?? "";
  const yCol = (config.y_columns ?? [])[0] ?? columns[1] ?? "";
  const valueCol = config.value_column ?? columns[2] ?? "";

  const xs = [...new Set(rows.map((r) => str(r[xCol])))];
  const ys = [...new Set(rows.map((r) => str(r[yCol])))];
  const data = rows.map((r) => [xs.indexOf(str(r[xCol])), ys.indexOf(str(r[yCol])), num(r[valueCol])]);

  return {
    tooltip: { position: "top" },
    grid: { top: 20, bottom: 40, left: "15%", right: "5%", containLabel: true },
    xAxis: { type: "category", data: xs, splitArea: { show: true } },
    yAxis: { type: "category", data: ys, splitArea: { show: true } },
    visualMap: { min: Math.min(...data.map((d) => d[2] as number)), max: Math.max(...data.map((d) => d[2] as number)), calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#e0e7ff", "#6366f1"] } },
    series: [{ type: "heatmap", data, label: { show: xs.length <= 10 }, emphasis: { itemStyle: { shadowBlur: 10 } } }],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChartRenderer({
  chartType,
  config,
  columns,
  rows,
  height = "100%",
  loading = false,
  onDataPointClick,
}: ChartRendererProps) {
  if (!rows.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No data
      </div>
    );
  }

  if (chartType === "kpi") return <KpiRenderer config={config} rows={rows} columns={columns} />;
  if (chartType === "table") return <TableRenderer columns={columns} rows={rows} />;

  let option: EChartsOption;
  if (chartType === "bar")         option = barOption(config, columns, rows);
  else if (chartType === "line")   option = lineOption(config, columns, rows);
  else if (chartType === "area")   option = lineOption(config, columns, rows, true);
  else if (chartType === "pie")    option = pieOption(config, columns, rows);
  else if (chartType === "donut")  option = pieOption(config, columns, rows, true);
  else if (chartType === "scatter") option = scatterOption(config, columns, rows);
  else if (chartType === "combo")  option = comboOption(config, columns, rows);
  else if (chartType === "funnel") option = funnelOption(config, columns, rows);
  else if (chartType === "heatmap") option = heatmapOption(config, columns, rows);
  else {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Unsupported chart type: {chartType}
      </div>
    );
  }

  const onEvents = onDataPointClick
    ? {
        click: (params: unknown) => {
          const p = params as { name?: string; value?: unknown; seriesName?: string };
          const dimension = config.x_column ?? columns[0] ?? "value";
          const value = p.name ?? p.value;
          onDataPointClick(dimension, value);
        },
      }
    : undefined;

  return (
    <EChartsBase
      option={option}
      height={height}
      loading={loading}
      onEvents={onEvents}
    />
  );
}
