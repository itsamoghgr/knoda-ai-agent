"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, ChevronUp, Loader2, X, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/api";

// ─── Tool label map ────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  execute_sql:           "Running query",
  run_sql:               "Running query",
  list_databases:        "Listing databases",
  explore_schema:        "Exploring schema",
  describe_table:        "Reading table schema",
  get_cataloged_tables:  "Loading cataloged tables",
  get_semantic_catalog:  "Searching AI Memory",
  search_tables:         "Searching tables",
  get_relationships:     "Loading relationships",
  save_classification:   "Saving classification",
  save_relationships:    "Saving relationships",
  create_chart:          "Creating chart",
  list_charts:           "Listing charts",
  create_dashboard:      "Creating dashboard",
  list_dashboards:       "Listing dashboards",
  add_chart_to_dashboard: "Adding to dashboard",
  get_dashboard_charts:  "Loading dashboard charts",
};

// ─── Single step ──────────────────────────────────────────────────────────────

function ActivityStep({
  message,
  index,
}: {
  message: ChatMessage;
  index: number;
}) {
  const [sqlExpanded, setSqlExpanded] = useState(false);
  const toolName  = message.toolName ?? "tool";
  const label     = TOOL_LABELS[toolName] ?? toolName;
  const isSql     = toolName === "execute_sql" || toolName === "run_sql";
  const rows      = message.toolResult?.rows ?? [];
  const hasError  = Boolean(message.toolResult?.error);
  const truncated = message.toolResult?.truncated ?? false;

  const resultSummary = hasError
    ? message.toolResult!.error!
    : isSql
      ? rows.length > 0
        ? `${rows.length}${truncated ? "+" : ""} row${rows.length !== 1 ? "s" : ""}`
        : "No rows"
      : (message.toolResult?.text ?? "").slice(0, 60) + ((message.toolResult?.text ?? "").length > 60 ? "…" : "");

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      className="space-y-1.5"
    >
      {/* Step header */}
      <div className="flex items-center gap-2.5 text-sm">
        {/* Status icon */}
        <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full">
          {message.isLoading ? (
            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
          ) : hasError ? (
            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-destructive/15">
              <X className="h-2.5 w-2.5 text-destructive" />
            </span>
          ) : (
            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-2.5 w-2.5 text-emerald-500" />
            </span>
          )}
        </span>

        {/* Label */}
        <span className={cn(
          "font-medium",
          message.isLoading ? "text-foreground" : "text-muted-foreground",
        )}>
          {label}
          {message.isLoading && "…"}
        </span>

        {/* Result badge */}
        {!message.isLoading && resultSummary && (
          <Badge
            variant="secondary"
            className={cn(
              "ml-auto text-[10px] px-1.5 py-0 h-4 font-mono",
              hasError && "bg-destructive/10 text-destructive border-destructive/20",
            )}
          >
            {resultSummary}
          </Badge>
        )}
      </div>

      {/* SQL preview (collapsible) */}
      {isSql && message.toolInput && message.toolInput.trim() !== "" && message.toolInput.trim() !== "{}" && (
        <div className="ml-7">
          <button
            onClick={() => setSqlExpanded(e => !e)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors mb-1"
          >
            {sqlExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            {sqlExpanded ? "Hide SQL" : "View SQL"}
          </button>
          <AnimatePresence>
            {sqlExpanded && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden text-[10px] font-mono text-foreground/70 bg-muted/40 rounded-md px-2.5 py-2 border border-border/40 overflow-x-auto whitespace-pre"
              >
                {message.toolInput}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

// ─── ActivityStream ────────────────────────────────────────────────────────────

interface ActivityStreamProps {
  tools: ChatMessage[];
  isStreaming: boolean;
}

export function ActivityStream({ tools, isStreaming }: ActivityStreamProps) {
  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);
  const prevStreamingRef = useRef(isStreaming);

  // Auto-collapse when streaming transitions from true → false.
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setManuallyExpanded(null); // eslint-disable-line react-hooks/set-state-in-effect
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  if (tools.length === 0) return null;

  const isExpanded = manuallyExpanded !== null ? manuallyExpanded : isStreaming;
  const completedSteps = tools.filter(t => !t.isLoading).length;
  const hasError = tools.some(t => Boolean(t.toolResult?.error));

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden"
    >
      {/* Collapsed summary / header */}
      <button
        onClick={() => setManuallyExpanded(e => e === null ? !isStreaming : !e)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <Activity className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />

        {isStreaming ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground flex-1">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            Agent working…
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground flex-1">
            <span className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded-full",
              hasError ? "bg-destructive/15" : "bg-emerald-500/15",
            )}>
              {hasError
                ? <X className="h-2 w-2 text-destructive" />
                : <Check className="h-2 w-2 text-emerald-500" />
              }
            </span>
            {completedSteps} step{completedSteps !== 1 ? "s" : ""} completed
          </span>
        )}

        <span className="shrink-0 text-muted-foreground/40">
          {isExpanded
            ? <ChevronUp className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />
          }
        </span>
      </button>

      {/* Expanded steps */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0.5 space-y-2.5 border-t border-border/30">
              {tools.map((tool, i) => (
                <ActivityStep key={tool.id} message={tool} index={i} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
