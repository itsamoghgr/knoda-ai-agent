"use client";

import { motion } from "framer-motion";
import { BarChart2, Database, GitFork, Hash, Layers, TrendingUp } from "lucide-react";
import { useJobs } from "@/lib/hooks/use-jobs";

// ─── Suggestion card ──────────────────────────────────────────────────────────

interface SuggestionCardProps {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
  delay: number;
}

function SuggestionCard({ icon, label, sub, onClick, delay }: SuggestionCardProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.25, ease: "easeOut" }}
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 px-4 py-3.5 text-left hover:border-primary/30 hover:bg-muted/40 transition-all group"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium leading-snug">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
    </motion.button>
  );
}

// ─── Global suggestions (no specific job selected) ────────────────────────────

const GLOBAL_SUGGESTIONS = [
  {
    icon: <Database className="h-3.5 w-3.5" />,
    label: "What databases have been discovered?",
    sub: "Get an overview of all connected data sources",
  },
  {
    icon: <Layers className="h-3.5 w-3.5" />,
    label: "Which tables are fact tables?",
    sub: "Identify your core transactional tables",
  },
  {
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    label: "Show me all available revenue metrics",
    sub: "Discover measures related to revenue and GMV",
  },
  {
    icon: <GitFork className="h-3.5 w-3.5" />,
    label: "How are the tables related?",
    sub: "Explore foreign key relationships and join paths",
  },
];

// ─── Job-scoped suggestions ───────────────────────────────────────────────────

const JOB_SUGGESTIONS = [
  {
    icon: <Database className="h-3.5 w-3.5" />,
    label: "What tables are in this database?",
    sub: "List all discovered tables and their purpose",
  },
  {
    icon: <Hash className="h-3.5 w-3.5" />,
    label: "Show me the revenue metrics available",
    sub: "Find aggregatable measures across fact tables",
  },
  {
    icon: <BarChart2 className="h-3.5 w-3.5" />,
    label: "What was total revenue last month?",
    sub: "Run a live query and get an answer with a chart",
  },
  {
    icon: <GitFork className="h-3.5 w-3.5" />,
    label: "How are the tables related?",
    sub: "Explore foreign key relationships and join paths",
  },
];

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  jobId?: string | null;
  onSend: (msg: string) => void;
}

export function EmptyState({ jobId, onSend }: EmptyStateProps) {
  const { data: jobs } = useJobs();
  const job = jobId ? jobs?.find(j => j.id === jobId) : null;
  const suggestions = jobId ? JOB_SUGGESTIONS : GLOBAL_SUGGESTIONS;

  const completedJobs = jobs?.filter(j => j.status === "completed") ?? [];
  const totalTables   = completedJobs.reduce((sum, j) => sum + (j.tables_total ?? 0), 0);

  return (
    <div className="flex flex-col items-center text-center pt-10 pb-6 px-4 max-w-2xl mx-auto">
      {/* Icon */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-5"
      >
        <BarChart2 className="h-7 w-7 text-primary" />
      </motion.div>

      {/* Heading */}
      <motion.h2
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="text-xl font-semibold mb-1.5"
      >
        Your data analyst is ready.
      </motion.h2>

      {/* Sub-heading */}
      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-sm text-muted-foreground mb-2"
      >
        {job
          ? `Scoped to ${job.source_type} · ${job.tables_total ?? 0} tables discovered`
          : totalTables > 0
            ? `${completedJobs.length} database${completedJobs.length !== 1 ? "s" : ""} · ${totalTables} tables in AI Memory`
            : "Ask anything about your connected databases"
        }
      </motion.p>

      {/* Suggestions grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full mt-5">
        {suggestions.map((s, i) => (
          <SuggestionCard
            key={s.label}
            icon={s.icon}
            label={s.label}
            sub={s.sub}
            onClick={() => onSend(s.label)}
            delay={0.12 + i * 0.06}
          />
        ))}
      </div>
    </div>
  );
}
