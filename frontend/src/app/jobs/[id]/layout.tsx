"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Bot } from "lucide-react";
import Link from "next/link";
import { useJob } from "@/lib/hooks/use-jobs";
import { JobTabs } from "@/components/layout/job-tabs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { ChatPanel } from "@/components/layout/chat-panel";
import { cn } from "@/lib/utils";

export default function JobLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading } = useJob(id);
  const [chatOpen, setChatOpen] = useState(false);
  const isCompleted = job?.status === "completed";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b px-6 py-4">
        <Link
          href="/databases"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All DBs
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-3 flex-1">
          <h1 className="font-semibold truncate">
            {isLoading ? "Loading…" : (job?.source_type ?? id)}
          </h1>
          {job && <JobStatusBadge status={job.status} />}
          {job && job.tables_total > 0 && (
            <span className="text-xs text-muted-foreground">
              {job.tables_total} tables
            </span>
          )}
        </div>
        <span className="font-mono text-xs text-muted-foreground">{id.slice(0, 8)}</span>

        {/* Scoped AI chat button — plain <button> avoids Base UI hydration ID mismatch */}
        <button
          disabled={!isCompleted}
          onClick={() => setChatOpen((o) => !o)}
          title={isCompleted ? "Ask questions about this database" : "Available after discovery completes"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
            chatOpen ? "bg-primary text-primary-foreground border-primary" : "bg-background",
          )}
        >
          <Bot className="h-3.5 w-3.5" />
          Ask AI
        </button>
      </div>

      {/* Tabs */}
      {job && <JobTabs jobId={id} job={job} />}

      {/* Page content + scoped chat panel side by side */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">{children}</div>

        {chatOpen && (
          <div className="w-[400px] shrink-0 border-l flex flex-col overflow-hidden">
            <ChatPanel
              jobId={id}
              title={job?.source_type ?? "This database"}
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
