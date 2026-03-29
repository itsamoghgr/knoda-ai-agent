"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  GitBranch,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { ConnectDatabaseDialog } from "@/components/jobs/connect-database-dialog";
import { BANNER } from "@/lib/theme";
import { useDeleteJob, useJobs } from "@/lib/hooks/use-jobs";
import { useSettings } from "@/lib/hooks/use-settings";
import { isLlmConfigured } from "@/lib/llm-settings";
import type { JobResponse } from "@/types/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  postgres:   { icon: "🐘", label: "PostgreSQL",   color: "bg-blue-100 dark:bg-blue-950/40" },
  mysql:      { icon: "🐬", label: "MySQL",         color: "bg-orange-100 dark:bg-orange-950/40" },
  duckdb:     { icon: "🦆", label: "DuckDB",        color: "bg-yellow-100 dark:bg-yellow-950/40" },
  s3_parquet: { icon: "☁️",  label: "S3 / Parquet",  color: "bg-sky-100 dark:bg-sky-950/40" },
  trino:      { icon: "⚡",  label: "Trino",         color: "bg-purple-100 dark:bg-purple-950/40" },
};

const ACTIVE_STATUSES = new Set(["pending", "bootstrapping", "running"]);

function ageLabel(createdAt: string) {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 60_000)     return "just now";
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60)   return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ─── Job card ─────────────────────────────────────────────────────────────────

function JobCard({ job, onEdit }: { job: JobResponse; onEdit: (job: JobResponse) => void }) {
  const deleteMutation = useDeleteJob();
  const meta = SOURCE_META[job.source_type] ?? { icon: "🗄️", label: job.source_type, color: "bg-muted" };
  const isActive    = ACTIVE_STATUSES.has(job.status);
  const isCompleted = job.status === "completed";

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this job and all its data?")) return;
    try {
      await deleteMutation.mutateAsync(job.id);
      toast.success("Job deleted.");
    } catch {
      toast.error("Failed to delete job.");
    }
  }

  function handleEdit(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onEdit(job);
  }

  return (
    <Link href={`/jobs/${job.id}`}>
      <div className="group relative flex flex-col rounded-xl border bg-card hover:border-primary/30 hover:shadow-md transition-all cursor-pointer overflow-hidden h-full">

        {/* Running pulse strip */}
        {isActive && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60 animate-pulse" />
        )}

        <div className="flex items-start gap-4 p-5">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${meta.color}`}>
            {meta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-base truncate flex-1">{meta.label}</p>
              <JobStatusBadge status={job.status} />
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{job.id.slice(0, 8)}</p>
          </div>
        </div>

        <div className="px-5 pb-4 flex-1 space-y-3">
          {isActive && job.tables_total > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {job.status}…
                </span>
                <span>{job.tables_processed}/{job.tables_total} tables</span>
              </div>
              <Progress value={job.progress_pct} className="h-1.5" />
            </div>
          )}

          {isCompleted && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                <p className="text-sm font-semibold">{job.tables_total}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Tables</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                <p className="text-sm font-semibold">{job.tables_total}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Models</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                <p className="text-sm font-semibold">
                  {job.duration_seconds != null ? formatDuration(job.duration_seconds) : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Duration</p>
              </div>
            </div>
          )}

          {job.error_message && (
            <p className="text-xs text-destructive truncate" title={job.error_message}>
              {job.error_message}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {ageLabel(job.created_at)}
          </span>
          <div className="invisible group-hover:visible flex items-center gap-1">
            <button
              onClick={handleEdit}
              title="Edit connection"
              className="rounded-md p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleDelete}
              title="Delete"
              className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onConnect, llmConfigured }: { onConnect: () => void; llmConfigured: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center gap-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Database className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold">No databases connected yet</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Connect a database and the agent will automatically discover its schema, relationships, and generate a semantic layer.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 mt-2 max-w-sm">
        {[
          { icon: Table2,    text: "Schema discovery" },
          { icon: GitBranch, text: "Relationship mapping" },
          { icon: Layers,    text: "Semantic layer" },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-xs text-center leading-tight">{text}</span>
          </div>
        ))}
      </div>
      {llmConfigured ? (
        <Button onClick={onConnect} size="lg">
          <Plus className="h-4 w-4 mr-2" />
          Connect your first database
        </Button>
      ) : (
        <Link href="/settings" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Configure LLM to get started
        </Link>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function DatabasesPageInner() {
  const { data: settings } = useSettings();
  const { data: jobs, isLoading } = useJobs();
  const llmConfigured = isLlmConfigured(settings);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editJob, setEditJob] = useState<JobResponse | null>(null);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setDialogOpen(true);
      router.replace("/databases");
    }
  }, [searchParams, router]);

  function handleEdit(job: JobResponse) {
    setEditJob(job);
    setDialogOpen(true);
  }

  function handleDialogClose(open: boolean) {
    setDialogOpen(open);
    if (!open) setEditJob(null);
  }


  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Databases</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your connected data sources.
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={!llmConfigured}
          title={!llmConfigured ? "Configure LLM first in Settings" : undefined}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Discovery
        </Button>
      </div>

      {/* LLM warning */}
      {settings && !llmConfigured && (
        <Alert className={BANNER.warning}>
          <AlertTriangle className="h-4 w-4 text-orange-500 dark:text-orange-400" />
          <AlertDescription className="flex items-center justify-between">
            <span>Configure an LLM provider before starting a discovery.</span>
            <Link
              href="/settings"
              className={`ml-4 ${buttonVariants({ size: "sm", variant: "outline" })} border-orange-300 hover:bg-orange-100 dark:border-orange-700 dark:hover:bg-orange-950/40`}
            >
              Configure now
            </Link>
          </AlertDescription>
        </Alert>
      )}


      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : !jobs?.length ? (
        <EmptyState onConnect={() => setDialogOpen(true)} llmConfigured={llmConfigured} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => <JobCard key={job.id} job={job} onEdit={handleEdit} />)}
        </div>
      )}

      <ConnectDatabaseDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        editJob={editJob ? { id: editJob.id, source_config_safe: editJob.source_config_safe ?? {} } : undefined}
      />
    </div>
  );
}

export default function DatabasesPage() {
  return (
    <Suspense>
      <DatabasesPageInner />
    </Suspense>
  );
}
