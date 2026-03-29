import type { JobStatus } from "@/types/api";

// ─── Job lifecycle status ─────────────────────────────────────────────────────

export const STATUS_STYLES: Record<JobStatus, { label: string; className: string }> = {
  pending:      { label: "Pending",      className: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700" },
  bootstrapping:{ label: "Bootstrapping",className: "bg-blue-100 text-blue-700 border-blue-200 animate-pulse dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800" },
  running:      { label: "Running",      className: "bg-violet-100 text-violet-700 border-violet-200 animate-pulse dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800" },
  completed:    { label: "Completed",    className: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800" },
  failed:       { label: "Failed",       className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
  cancelled:    { label: "Cancelled",    className: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700" },
};

// ─── Discovery phases ─────────────────────────────────────────────────────────

export const PHASE_STYLES: Record<string, string> = {
  bootstrap: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  running:   "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  thinking:  "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  done:      "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
};

// ─── Relationship confidence ──────────────────────────────────────────────────

export const CONF_STYLES = {
  high: {
    badge:  "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
    // SVG hex values — CSS vars don't resolve in SVG fill/stroke
    stroke: "#16a34a",
    bg:     "#dcfce7",
    text:   "#15803d",
  },
  med: {
    badge:  "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    stroke: "#d97706",
    bg:     "#fef3c7",
    text:   "#b45309",
  },
  low: {
    badge:  "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
    stroke: "#dc2626",
    bg:     "#fee2e2",
    text:   "#b91c1c",
  },
} as const;

export type ConfLevel = keyof typeof CONF_STYLES;

export function getConfLevel(confidence: number): ConfLevel {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "med";
  return "low";
}

// ─── Semantic layer table types ───────────────────────────────────────────────

export const TABLE_TYPE_STYLES: Record<string, string> = {
  fact:      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  dimension: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  bridge:    "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400",
  unknown:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

// ─── SQL column data types ────────────────────────────────────────────────────

export const SQL_TYPE_STYLES: Record<string, string> = {
  int:       "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  integer:   "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  bigint:    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  varchar:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  text:      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  boolean:   "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  timestamp: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  date:      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  float:     "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  double:    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  decimal:   "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  uuid:      "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400",
};

// ─── SVG / ReactFlow hex values ───────────────────────────────────────────────
// CSS variables cannot be resolved inside SVG fill/stroke attributes — use hex

export const SVG_COLORS = {
  confHigh:      "#16a34a",
  confMed:       "#d97706",
  confLow:       "#dc2626",
  edgeLabel:     "#475569",
  edgeLabelBg:   "#ffffff",
  explicitFK:    "#64748b",
  inferredFK:    "#94a3b8",
  flowBg:        "#e5e7eb",
  minimapNode:   "#f8fafc",
  minimapStroke: "#94a3b8",
} as const;

// ─── Banner / alert classes ───────────────────────────────────────────────────

export const BANNER = {
  warning: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  success: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400",
  error:   "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400",
} as const;

// ─── Miscellaneous ────────────────────────────────────────────────────────────

export const STEPPER_DONE_CLASS  = "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400";
export const STEPPER_DONE_LINE   = "bg-green-300 dark:bg-green-800";
export const NULL_WARNING_CLASS  = "bg-orange-50 dark:bg-orange-950/30";
export const NULL_WARNING_TEXT   = "text-orange-600 dark:text-orange-400";
