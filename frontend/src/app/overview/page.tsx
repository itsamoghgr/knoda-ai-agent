"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  GitBranch,
  Layers,
  MessageSquareText,
  Plus,
  Settings,
  Table2,
  Zap,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useSettings } from "@/lib/hooks/use-settings";
import { useUsage } from "@/lib/hooks/use-usage";
import { getActiveLlmLabel, isLlmConfigured } from "@/lib/llm-settings";
import type { JobResponse } from "@/types/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { icon: string; color: string }> = {
  postgres:   { icon: "🐘", color: "bg-blue-100 dark:bg-blue-950/40" },
  mysql:      { icon: "🐬", color: "bg-orange-100 dark:bg-orange-950/40" },
  duckdb:     { icon: "🦆", color: "bg-yellow-100 dark:bg-yellow-950/40" },
  s3_parquet: { icon: "☁️",  color: "bg-sky-100 dark:bg-sky-950/40" },
  trino:      { icon: "⚡",  color: "bg-purple-100 dark:bg-purple-950/40" },
};

const ACTIVE_STATUSES = new Set(["pending", "bootstrapping", "running"]);

function ageLabel(createdAt: string) {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 60_000)     return "just now";
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, highlight }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 flex items-center gap-4 ${highlight ? "bg-primary/5 border-primary/20" : "bg-card"}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${highlight ? "bg-primary/15" : "bg-muted"}`}>
        <Icon className={`h-5 w-5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Recent database row ──────────────────────────────────────────────────────

function RecentJobRow({ job }: { job: JobResponse }) {
  const meta = SOURCE_META[job.source_type] ?? { icon: "🗄️", color: "bg-muted" };
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center gap-4 rounded-xl border bg-card px-4 py-3 hover:border-primary/30 hover:shadow-sm transition-all"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${meta.color}`}>
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium capitalize">{job.source_type}</p>
        <p className="text-xs text-muted-foreground font-mono">{job.id.slice(0, 8)}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {job.tables_total > 0 && (
          <span className="text-xs text-muted-foreground">{job.tables_total} tables</span>
        )}
        <JobStatusBadge status={job.status} />
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />{ageLabel(job.created_at)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
    </Link>
  );
}

// ─── Quick action card ────────────────────────────────────────────────────────

function QuickAction({ href, icon: Icon, label, description, highlight }: {
  href: string;
  icon: React.ElementType;
  label: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-xl border px-4 py-4 transition-all hover:shadow-sm ${highlight ? "border-primary/30 bg-primary/5 hover:bg-primary/10" : "bg-card hover:border-primary/20"}`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${highlight ? "bg-primary/15" : "bg-muted group-hover:bg-primary/10"} transition-colors`}>
        <Icon className={`h-5 w-5 ${highlight ? "text-primary" : "text-muted-foreground group-hover:text-primary"} transition-colors`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors shrink-0" />
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function DashboardPage() {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const { data: jobs, isLoading: jobsLoading } = useJobs();
  const { data: usage } = useUsage();

  const llmConfigured = isLlmConfigured(settings);
  const totalJobs       = jobs?.length ?? 0;
  const completedJobs   = jobs?.filter((j) => j.status === "completed").length ?? 0;
  const activeJobs      = jobs?.filter((j) => ACTIVE_STATUSES.has(j.status)).length ?? 0;
  const totalTables     = jobs?.reduce((s, j) => s + (j.tables_total ?? 0), 0) ?? 0;

  const recentJobs = jobs?.slice().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ).slice(0, 5) ?? [];

  const isLoading = settingsLoading || jobsLoading;

  return (
    <div className="p-6 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your database discovery workspace.
        </p>
      </div>

      {/* LLM not configured notice */}
      {!settingsLoading && !llmConfigured && (
        <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm dark:border-orange-800 dark:bg-orange-950/30">
          <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-orange-800 dark:text-orange-300">LLM not configured</p>
            <p className="text-orange-700 dark:text-orange-400 mt-0.5 text-xs">
              Set up an LLM provider in Settings before starting a discovery.
            </p>
          </div>
          <Link href="/settings" className={buttonVariants({ size: "sm", variant: "outline" }) + " border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/40 shrink-0"}>
            Configure
          </Link>
        </div>
      )}

      {/* Stats */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[74px] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard icon={Database}     label="Databases"        value={totalJobs} />
          <StatCard icon={CheckCircle2} label="Discovered"       value={completedJobs} highlight={completedJobs > 0} />
          <StatCard icon={Table2}       label="Tables found"     value={totalTables} />
          <StatCard icon={Zap}          label="Active jobs"      value={activeJobs} highlight={activeJobs > 0} />
          <StatCard
            icon={BrainCircuit}
            label="Tokens used"
            value={usage ? formatTokens(usage.total_tokens) : "—"}
            sub={usage && usage.total_tokens > 0
              ? `↑${formatTokens(usage.input_tokens)} ↓${formatTokens(usage.output_tokens)}`
              : undefined}
          />
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Recent databases */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent databases</h2>
            <Link href="/databases" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {jobsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : recentJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <Database className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">No databases yet</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Connect one to get started</p>
              </div>
              <Link href="/databases" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Connect database
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentJobs.map((job) => <RecentJobRow key={job.id} job={job} />)}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold">Quick actions</h2>
          <div className="space-y-2">
            <QuickAction
              href="/databases"
              icon={Plus}
              label="New Discovery"
              description="Connect and discover a database"
              highlight
            />
            <QuickAction
              href="/chat"
              icon={MessageSquareText}
              label="Ask AI"
              description="Query across all your databases"
            />
            <QuickAction
              href="/databases"
              icon={Database}
              label="Databases"
              description="View and manage connections"
            />
            <QuickAction
              href="/settings"
              icon={Settings}
              label="Settings"
              description={getActiveLlmLabel(settings) ?? "Configure LLM provider"}
            />
          </div>
        </div>
      </div>

      {/* Token usage breakdown — shown once there are tokens recorded */}
      {usage && usage.total_tokens > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BrainCircuit className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Token usage</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatTokens(usage.total_tokens)} total
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Discovery */}
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Discovery</span>
                <span className="text-sm font-bold">{formatTokens(usage.by_context.discovery)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/70 transition-all"
                  style={{ width: usage.total_tokens > 0 ? `${(usage.by_context.discovery / usage.total_tokens) * 100}%` : "0%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Agent discovery runs</p>
            </div>

            {/* Chat */}
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chat</span>
                <span className="text-sm font-bold">{formatTokens(usage.by_context.chat)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500/70 transition-all"
                  style={{ width: usage.total_tokens > 0 ? `${(usage.by_context.chat / usage.total_tokens) * 100}%` : "0%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">AI chat conversations</p>
            </div>

            {/* Input / Output split */}
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Input / Output</span>
              <div className="flex gap-3">
                <div className="flex-1 text-center">
                  <p className="text-sm font-bold">{formatTokens(usage.input_tokens)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Prompt</p>
                </div>
                <div className="w-px bg-border" />
                <div className="flex-1 text-center">
                  <p className="text-sm font-bold">{formatTokens(usage.output_tokens)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Completion</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* What the agent does — shown when no databases */}
      {!jobsLoading && totalJobs === 0 && (
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-sm font-semibold mb-4">What Knoda.ai does</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: Database,   title: "Schema discovery",      desc: "Automatically maps all tables, columns, types, and constraints." },
              { icon: GitBranch,  title: "Relationship mapping",  desc: "Detects foreign keys and infers relationships using AI." },
              { icon: Layers,     title: "Semantic layer",        desc: "Generates dbt-compatible models with dimensions and measures." },
              { icon: BarChart3,  title: "Data profiles",        desc: "Profiles row counts, nulls, distributions, and sample values." },
              { icon: MessageSquareText, title: "AI chat",         desc: "Ask questions about your schema in plain English." },
              { icon: CheckCircle2, title: "Read-only & safe",    desc: "Agent only reads — never writes to your source database." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
