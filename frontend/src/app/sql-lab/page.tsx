"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Clock,
  Eye,
  History,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Table2,
  Terminal,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useSqlLab, useSchemaQuery, type SqlResponse, type SchemaTable } from "@/lib/hooks/use-sql-lab";
import { apiUrl, authHeaders } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_EMOJI: Record<string, string> = {
  postgres:   "🐘",
  mysql:      "🐬",
  duckdb:     "🦆",
  s3_parquet: "☁️",
  trino:      "⚡",
};

const HISTORY_KEY = "sql_lab_history";
const MAX_HISTORY  = 20;

const PLACEHOLDER = `-- Write your SQL query here
-- Press Ctrl+Enter (or Cmd+Enter) to run

SELECT * FROM src0.public.users LIMIT 10;`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveToHistory(sql: string, prev: string[]): string[] {
  const trimmed = sql.trim();
  if (!trimmed) return prev;
  const deduped = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(deduped));
  return deduped;
}

function exportCsv(columns: string[], rows: Record<string, unknown>[]) {
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    columns.map(escape).join(","),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "query_result.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Schema browser ───────────────────────────────────────────────────────────

function SchemaGroup({
  schemaName,
  tables,
  defaultOpen,
  onTableClick,
}: {
  schemaName: string;
  tables: SchemaTable[];
  defaultOpen: boolean;
  onTableClick: (qualifiedName: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate font-mono">{schemaName}</span>
        <span className="ml-auto text-[10px] font-normal tabular-nums">{tables.length}</span>
      </button>

      {open && (
        <div className="ml-3 border-l pl-2 space-y-0.5 mb-1">
          {tables.map((t) => (
            <button
              key={t.table_name}
              onClick={() => onTableClick(t.qualified_name)}
              title={`Insert: ${t.qualified_name}`}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-foreground/80 hover:bg-accent hover:text-foreground transition-colors text-left group"
            >
              {t.table_type === "VIEW" ? (
                <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <Table2 className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate font-mono">{t.table_name}</span>
              {t.table_type === "VIEW" && (
                <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0 h-4 shrink-0">
                  view
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaBrowser({
  jobId,
  alias,
  onTableClick,
}: {
  jobId: string | null;
  alias: string;
  onTableClick: (qualifiedName: string) => void;
}) {
  const { data, isLoading, error } = useSchemaQuery(jobId);

  // Group tables by schema
  const groups: Record<string, SchemaTable[]> = {};
  if (data?.tables) {
    for (const t of data.tables) {
      if (!groups[t.schema_name]) groups[t.schema_name] = [];
      groups[t.schema_name].push(t);
    }
  }
  const schemaNames = Object.keys(groups);

  return (
    <aside className="flex h-full flex-col border-r bg-muted/20 w-56 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2.5 shrink-0">
        <span className="text-xs font-semibold">Schema</span>
        {jobId && (
          <code className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary">
            {alias}
          </code>
        )}
      </div>

      {/* Alias hint */}
      {jobId && (
        <div className="border-b px-3 py-2 shrink-0 bg-muted/40">
          <p className="text-[10px] text-muted-foreground leading-tight">
            Reference tables as:
          </p>
          <code className="text-[10px] font-mono text-foreground/70">
            {alias}.<span className="text-muted-foreground">schema</span>.<span className="text-muted-foreground">table</span>
          </code>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-2 px-1">
        {!jobId && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            Select a database to browse its schema.
          </p>
        )}

        {isLoading && jobId && (
          <div className="space-y-1.5 px-3 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        )}

        {error && (
          <div className="px-3 py-3 text-xs text-destructive">
            Failed to load schema.
          </div>
        )}

        {data?.error && (
          <div className="px-3 py-3 text-xs text-destructive">
            {data.error}
          </div>
        )}

        {!isLoading && !error && schemaNames.length === 0 && jobId && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            No tables found.
          </p>
        )}

        {schemaNames.map((schemaName, idx) => (
          <SchemaGroup
            key={schemaName}
            schemaName={schemaName}
            tables={groups[schemaName]}
            defaultOpen={idx === 0}
            onTableClick={onTableClick}
          />
        ))}
      </div>
    </aside>
  );
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsTable({ result }: { result: SqlResponse }) {
  if (result.error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <pre className="text-sm text-destructive font-mono whitespace-pre-wrap break-all">
          {result.error}
        </pre>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        Query completed in {result.execution_time_ms} ms — no rows returned.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border h-full">
      {result.row_count >= 10_000 && (
        <div className="flex items-center gap-2 border-b bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 sticky top-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {result.row_count.toLocaleString()} rows returned. Consider adding a LIMIT clause for large result sets.
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            {result.columns.map((col) => (
              <th
                key={col}
                className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground border-b tracking-wide"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
              {result.columns.map((col) => (
                <td
                  key={col}
                  className="px-3 py-2 font-mono text-xs text-foreground/80 max-w-xs truncate"
                  title={row[col] == null ? "NULL" : String(row[col])}
                >
                  {row[col] == null ? (
                    <span className="text-muted-foreground italic">NULL</span>
                  ) : (
                    String(row[col])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SqlLabPage() {
  const { data: jobs } = useJobs();
  const mutation       = useSqlLab();
  const router         = useRouter();

  const completedJobs = jobs?.filter((j) => j.status === "completed") ?? [];

  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [sql,           setSql]           = useState("");
  const [result,        setResult]        = useState<SqlResponse | null>(null);
  const [history,       setHistory]       = useState<string[]>([]);

  // Inline AI box state
  const [aiBoxOpen,     setAiBoxOpen]     = useState(false);
  const [aiPrompt,      setAiPrompt]      = useState("");
  const [aiLoading,     setAiLoading]     = useState(false);
  const aiInputRef = useRef<HTMLInputElement>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Derive the alias hint from schema query data (always "src0")
  const { data: schemaData } = useSchemaQuery(selectedJobId || null);
  const alias = schemaData?.alias ?? "src0";

  // Load history and auto-select first job on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!selectedJobId && completedJobs.length > 0) {
      setSelectedJobId(completedJobs[0].id);
    }
  }, [completedJobs, selectedJobId]);

  // Insert table name at cursor position in the editor
  const handleTableClick = useCallback((qualifiedName: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setSql((prev) => prev ? `${prev}\n${qualifiedName}` : qualifiedName);
      return;
    }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const before = sql.slice(0, start);
    const after  = sql.slice(end);
    const newSql = `${before}${qualifiedName}${after}`;
    setSql(newSql);
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + qualifiedName.length;
      ta.setSelectionRange(pos, pos);
    });
  }, [sql]);

  const handleRun = useCallback(async () => {
    if (!selectedJobId) {
      toast.error("Select a database first.");
      return;
    }
    const trimmed = sql.trim();
    if (!trimmed) {
      toast.error("Write a SQL query first.");
      return;
    }
    try {
      const res = await mutation.mutateAsync({ jobId: selectedJobId, sql: trimmed });
      setResult(res);
      setHistory((prev) => saveToHistory(trimmed, prev));
    } catch (err) {
      toast.error((err as Error).message ?? "Query failed.");
    }
  }, [selectedJobId, sql, mutation]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  }

  function handleHistorySelect(query: string) {
    setSql(query);
    textareaRef.current?.focus();
  }

  function handleClear() {
    setSql("");
    setResult(null);
    textareaRef.current?.focus();
  }

  // Open AI box and auto-focus the input
  function handleOpenAiBox() {
    setAiBoxOpen(true);
    requestAnimationFrame(() => aiInputRef.current?.focus());
  }

  // Stream the chat endpoint, collect all tokens, extract first SQL block
  async function generateSql() {
    const prompt = aiPrompt.trim();
    if (!prompt || !selectedJobId || aiLoading) return;

    setAiLoading(true);
    try {
      const auth = await authHeaders();
      const response = await fetch(apiUrl("/agent"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          job_id: selectedJobId,
          message: `Generate SQL for: ${prompt}. Return ONLY the SQL query inside a \`\`\`sql code block. No explanation, no prose — just the SQL. Use alias.schema.table naming (e.g. src0.public.users).`,
          history: [],
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `Error ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              if ((currentEvent === "token" || currentEvent === "message") && parsed.token) {
                accumulated += parsed.token as string;
              }
            } catch { /* ignore */ }
            currentEvent = "message";
          }
        }
      }

      // Extract first ```sql ... ``` block
      const match = /```sql\s*([\s\S]*?)```/i.exec(accumulated);
      const extracted = match ? match[1].trim() : accumulated.trim();

      if (!extracted) {
        toast.error("AI didn't return SQL. Try rephrasing.");
        return;
      }

      setSql(extracted);
      setAiBoxOpen(false);
      setAiPrompt("");
      toast.success("SQL generated and inserted.");
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to generate SQL.");
    } finally {
      setAiLoading(false);
    }
  }

  const isRunning = mutation.isPending;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Schema browser ───────────────────────────────────────── */}
      <SchemaBrowser
        jobId={selectedJobId || null}
        alias={alias}
        onTableClick={handleTableClick}
      />

      {/* ── Right: Editor + Results ────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Terminal className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">SQL Lab</h1>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                Run read-only queries against your connected databases
              </p>
            </div>
          </div>

          {/* Database selector + AI button */}
          <div className="flex items-center gap-2">
            {completedJobs.length === 0 ? (
              <span className="text-xs text-muted-foreground">No completed databases</span>
            ) : (
              <Select value={selectedJobId} onValueChange={(v) => setSelectedJobId(v ?? "")}>
                <SelectTrigger className="w-60 h-8 text-sm">
                  <SelectValue placeholder="Select database…" />
                </SelectTrigger>
                <SelectContent>
                  {completedJobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      <span className="flex items-center gap-2">
                        <span>{SOURCE_EMOJI[job.source_type] ?? "🗄️"}</span>
                        <span className="font-medium capitalize">{job.source_type}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {job.id.slice(0, 8)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

          </div>
        </div>

        {/* Editor area */}
        <div className="px-6 pt-4 pb-3 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Query editor
            </span>
            <div className="flex items-center gap-1.5">
              {/* Query history */}
              {history.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border border-transparent bg-transparent hover:bg-accent hover:text-accent-foreground transition-colors">
                    <History className="h-3.5 w-3.5" />
                    History
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[480px] max-h-72 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                      Recent queries (click to load)
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {history.map((q, i) => (
                      <DropdownMenuItem
                        key={i}
                        onSelect={() => handleHistorySelect(q)}
                        className="font-mono text-xs py-2 cursor-pointer"
                      >
                        <span className="truncate">{q}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Clear */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleClear}
                disabled={!sql && !result}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>

          {/* Textarea editor */}
          <div className="relative rounded-lg border bg-muted/20 focus-within:ring-1 focus-within:ring-ring transition-shadow">
            <Textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              className="font-mono text-sm min-h-[160px] resize-y border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 py-3 px-3 leading-relaxed"
            />

            {/* AI prompt box — shown just above the footer when open */}
            {aiBoxOpen && (
              <div className="border-t bg-muted/30 px-3 py-2.5 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                <input
                  ref={aiInputRef}
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); generateSql(); }
                    if (e.key === "Escape") { setAiBoxOpen(false); setAiPrompt(""); }
                  }}
                  placeholder="Describe the SQL you need… (Enter to generate)"
                  disabled={aiLoading}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                />
                {aiLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                ) : (
                  <button
                    onClick={() => { setAiBoxOpen(false); setAiPrompt(""); }}
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    aria-label="Close AI box"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {selectedJobId ? (
                  <>
                    Tables:{" "}
                    <code className="font-mono text-foreground/70">
                      {alias}.<span className="text-muted-foreground">schema</span>.<span className="text-muted-foreground">table</span>
                    </code>
                    {" · "}
                  </>
                ) : null}
                <kbd className="rounded border px-1 py-0.5 text-[10px] font-mono bg-background">
                  Ctrl
                </kbd>
                {" + "}
                <kbd className="rounded border px-1 py-0.5 text-[10px] font-mono bg-background">
                  Enter
                </kbd>
                {" to run"}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenAiBox}
                  disabled={!selectedJobId}
                  className={cn("h-7 gap-1.5 text-xs", aiBoxOpen && "bg-primary/10 border-primary/40 text-primary")}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Ask AI
                </Button>
                <Button
                  size="sm"
                  onClick={handleRun}
                  disabled={isRunning || !selectedJobId || !sql.trim()}
                  className="h-7 gap-1.5 text-xs"
                >
                  {isRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {isRunning ? "Running…" : "Run"}
                </Button>
                {result && !result.error && sql.trim() && selectedJobId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() =>
                      router.push(
                        `/charts/new?job_id=${encodeURIComponent(selectedJobId)}&sql=${encodeURIComponent(sql)}`
                      )
                    }
                  >
                    <BarChart2 className="h-3.5 w-3.5" />
                    Save as Chart
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Results area */}
        <div className="flex-1 overflow-hidden px-6 pb-6 flex flex-col gap-3 min-h-0">
          {result && (
            <>
              {/* Status bar */}
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {result.error ? (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Query failed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {result.row_count} {result.row_count === 1 ? "row" : "rows"} returned
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {result.execution_time_ms} ms
                  </span>
                </div>

                {!result.error && result.columns.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      exportCsv(result.columns, result.rows);
                      toast.success("CSV downloaded.");
                    }}
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Export CSV
                  </Button>
                )}
              </div>

              {/* Table / error */}
              <div className="flex-1 overflow-auto min-h-0">
                <ResultsTable result={result} />
              </div>
            </>
          )}

          {/* Empty state */}
          {!result && !isRunning && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center text-muted-foreground">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Terminal className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No query run yet</p>
                <p className="text-xs max-w-xs">
                  Select a table from the schema browser on the left, or write a query and press{" "}
                  <span className="font-mono">Ctrl+Enter</span>.
                </p>
              </div>
            </div>
          )}

          {/* Loading */}
          {isRunning && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Executing query…</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
