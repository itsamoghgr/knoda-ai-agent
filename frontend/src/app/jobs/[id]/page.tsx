"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  GitBranch,
  Layers,
  Loader2,
  Table2,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useJob } from "@/lib/hooks/use-jobs";
import { useJobStream, type StreamEvent } from "@/lib/hooks/use-job-stream";
import { Progress } from "@/components/ui/progress";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { PHASE_STYLES, STEPPER_DONE_CLASS, STEPPER_DONE_LINE } from "@/lib/theme";
import type { ProgressEvent } from "@/types/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60)  return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PHASES = ["bootstrap", "running", "done"] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABELS: Record<Phase, string> = {
  bootstrap: "Loading Schema",
  running:   "Agent Running",
  done:      "Complete",
};

const ACTIVE_STATUSES = ["pending", "bootstrapping", "running"];

function storageKey(jobId: string) {
  return `job-events:${jobId}`;
}

function loadStoredEvents(jobId: string): ProgressEvent[] {
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    return raw ? (JSON.parse(raw) as ProgressEvent[]) : [];
  } catch {
    return [];
  }
}

function saveStoredEvents(jobId: string, events: ProgressEvent[]) {
  try {
    localStorage.setItem(storageKey(jobId), JSON.stringify(events.slice(-300)));
  } catch {
    // storage full — ignore
  }
}

// ─── Phase stepper ────────────────────────────────────────────────────────────

function PhaseStepper({ currentPhase }: { currentPhase: string }) {
  const currentIdx = PHASES.indexOf(currentPhase as Phase);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.filter((p) => p !== "done").map((phase, i) => {
        const done   = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={phase} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                done
                  ? STEPPER_DONE_CLASS
                  : active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : active ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {PHASE_LABELS[phase]}
            </div>
            {i < PHASES.length - 2 && (
              <div className={`h-px w-6 ${done ? STEPPER_DONE_LINE : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JobProgressPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job } = useJob(id);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  const isActive    = job ? ACTIVE_STATUSES.includes(job.status) : false;
  const isCompleted = job?.status === "completed";
  const isFailed    = job?.status === "failed";

  // Load persisted events on mount
  useEffect(() => {
    if (!id || eventsLoaded) return;
    const stored = loadStoredEvents(id);
    if (stored.length) setEvents(stored);
    setEventsLoaded(true);
  }, [id, eventsLoaded]);

  const onEvent = useCallback(
    (event: StreamEvent) => {
      if (event._type === "progress") {
        const { _type: _, ...pe } = event;
        setEvents((prev) => {
          const next = [...prev, pe as ProgressEvent].slice(-300);
          saveStoredEvents(id, next);
          return next;
        });
      }
    },
    [id],
  );

  useJobStream(id, isActive, onEvent);

  // Derive current stepper phase from last event
  const lastPhase = events.at(-1)?.phase ?? "bootstrap";
  const currentPhase = isCompleted ? "done" : lastPhase;

  // Derive progress from saved model count (events with phase="running" and message starting "Saved:")
  const savedCount = events.filter(
    (e) => e.phase === "running" && e.message.startsWith("Saved:")
  ).length;

  return (
    <div className="p-6 space-y-6">

      {/* Top row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PhaseStepper currentPhase={currentPhase} />
        {job && <JobStatusBadge status={job.status} />}
      </div>

      {/* Progress bar */}
      {job && (job.tables_total > 0 || savedCount > 0) && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm text-muted-foreground">
            {job.tables_total > 0 ? (
              <>
                <span>{savedCount} / {job.tables_total} models saved</span>
                <span>{job.progress_pct}%</span>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading schema…
              </span>
            )}
          </div>
          <Progress
            value={job.tables_total > 0 ? Math.round((savedCount / job.tables_total) * 100) : 10}
            className="h-2"
          />
        </div>
      )}

      {/* Error */}
      {isFailed && job.error_message && (
        <div className="flex items-start gap-3 rounded-xl border p-4 text-sm border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{job.error_message}</span>
        </div>
      )}

      {/* Completed result cards */}
      {isCompleted && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Discovery complete — explore results using the tabs above.
            </div>
            {job.duration_seconds != null && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 rounded-full px-3 py-1">
                <Clock className="h-3 w-3" />
                Completed in {formatDuration(job.duration_seconds)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { href: `/jobs/${id}/catalog`,       icon: Table2,    label: "Tables",         value: job.tables_total },
              { href: `/jobs/${id}/relationships`, icon: GitBranch, label: "Relationships",  value: "→" },
              { href: `/jobs/${id}/semantic`,      icon: Layers,    label: "Semantic Layer", value: job.tables_total },
              { href: "/chat",                     icon: Bot,       label: "Ask AI",         value: "✦" },
            ].map(({ href, icon: Icon, label, value }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center justify-between rounded-xl border bg-card px-5 py-4 hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground group-hover:text-primary transition-colors font-medium">
                    {label}
                  </p>
                  <p className="text-3xl font-bold tracking-tight">{value}</p>
                </div>
                <Icon className="h-8 w-8 text-muted-foreground/20 group-hover:text-primary/30 transition-colors" />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Live event log */}
      {(isActive || events.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {isActive && <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />}
            <span className="text-sm font-medium">{isActive ? "Live events" : "Event log"}</span>
            <span className="text-xs text-muted-foreground">{events.length} events</span>
          </div>

          {events.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting…
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              {events.map((ev, i) => {
                const isThinking = ev.phase === "thinking";
                const phaseLabel =
                  ev.phase === "bootstrap" ? "Schema"
                  : ev.phase === "running"  ? "Agent"
                  : ev.phase === "thinking" ? "Think"
                  : ev.phase;

                return (
                  <div
                    key={i}
                    className={`flex items-start gap-3 px-4 py-2.5 text-sm border-b last:border-0 hover:bg-muted/20 ${
                      isThinking ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
                    }`}
                  >
                    <span className="shrink-0 w-[72px] text-[11px] text-muted-foreground font-mono mt-0.5">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                        PHASE_STYLES[ev.phase] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {phaseLabel}
                    </span>
                    {isThinking ? (
                      <div className="flex-1 leading-relaxed text-muted-foreground/70 text-xs [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-0.5 [&_hr]:my-1 [&_strong]:font-semibold [&_strong]:not-italic [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {ev.message}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <span className="flex-1 leading-relaxed text-muted-foreground">
                        {ev.message}
                      </span>
                    )}
                    {ev.table_name && (
                      <span className="shrink-0 font-mono text-[11px] bg-muted rounded px-1.5 py-0.5">
                        {ev.table_name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isCompleted && events.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Event log is captured during an active run and kept for the current browser session.
        </p>
      )}
    </div>
  );
}
