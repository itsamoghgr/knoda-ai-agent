"use client";

import { useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  CheckCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useSettings,
  useSaveProvider,
  useActivateProvider,
  useTestLlm,
  useEmbeddingSettings,
  useSaveEmbedding,
  useBusinessContext,
  useSaveBusinessContext,
} from "@/lib/hooks/use-settings";
import { useUsage, useUsageCalls } from "@/lib/hooks/use-usage";
import { formatDistanceToNow } from "date-fns";
import { BANNER } from "@/lib/theme";
import type { LlmProvider } from "@/types/api";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDERS: {
  id: LlmProvider;
  label: string;
  description: string;
  models: string[];
  color: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o, GPT-4o mini, and GPT-4 Turbo",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude Opus, Sonnet, and Haiku models",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
    color: "text-orange-600 dark:text-orange-400",
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Run models locally — no API key needed",
    models: [],
    color: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "groq",
    label: "Groq",
    description: "Fast inference via GroqCloud (Llama, Mixtral, Gemma)",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
    color: "text-violet-600 dark:text-violet-400",
  },
  {
    id: "featherless",
    label: "Featherless AI",
    description: "4,300+ open-source models — serverless, no GPU setup",
    models: [
      "Qwen/Qwen2.5-72B-Instruct",
      "meta-llama/Llama-3.3-70B-Instruct",
      "mistralai/Mistral-7B-Instruct-v0.3",
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    ],
    color: "text-sky-600 dark:text-sky-400",
  },
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Business context tab ─────────────────────────────────────────────────────

const BUSINESS_MODELS = ["B2C", "B2B", "B2B2C", "Marketplace", "SaaS", "Other"];
const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "Other"];
const FISCAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type BizFields = {
  company_description: string;
  business_model: string;
  fiscal_year_start: string;
  currency: string;
  revenue_definition: string;
  churn_definition: string;
  exclusions: string;
  additional_context: string;
};

const EMPTY_FIELDS: BizFields = {
  company_description: "",
  business_model: "",
  fiscal_year_start: "",
  currency: "",
  revenue_definition: "",
  churn_definition: "",
  exclusions: "",
  additional_context: "",
};

function hasSectionData(fields: BizFields, keys: (keyof BizFields)[]) {
  return keys.some((k) => fields[k].trim() !== "");
}

function SelectField({
  label, hint, value, options, placeholder, onChange,
}: {
  label: string; hint: string; value: string;
  options: string[]; placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm",
          "shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
          "text-foreground",
          !value && "text-muted-foreground",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TextField({
  label, hint, value, placeholder, onChange, multiline = false,
}: {
  label: string; hint: string; value: string; placeholder: string;
  onChange: (v: string) => void; multiline?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="text-sm resize-none"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-sm"
        />
      )}
    </div>
  );
}

function SectionHeader({ title, saved }: { title: string; saved: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {saved && (
        <span className="text-[10px] text-green-600 dark:text-green-400 font-medium border border-green-300 dark:border-green-700 rounded-full px-1.5 py-0.5">
          ✓ Saved
        </span>
      )}
    </div>
  );
}

function BusinessContextTab() {
  const { data, isLoading } = useBusinessContext();
  const saveMutation = useSaveBusinessContext();
  const [fields, setFields] = useState<BizFields>(EMPTY_FIELDS);
  const [initialized, setInitialized] = useState(false);

  if (!initialized && !isLoading && data !== undefined) {
    setFields({ ...EMPTY_FIELDS, ...(data as BizFields) });
    setInitialized(true);
  }

  function set(key: keyof BizFields) {
    return (value: string) => setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    try {
      await saveMutation.mutateAsync(fields);
      toast.success("Business context saved.");
    } catch {
      toast.error("Failed to save business context.");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  const isSaving = saveMutation.isPending;
  const savedData = data as BizFields | undefined;

  const companySaved  = hasSectionData(savedData ?? EMPTY_FIELDS, ["company_description", "business_model"]);
  const dataSaved     = hasSectionData(savedData ?? EMPTY_FIELDS, ["revenue_definition", "churn_definition", "fiscal_year_start", "currency"]);
  const rulesSaved    = hasSectionData(savedData ?? EMPTY_FIELDS, ["exclusions", "additional_context"]);

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
            <BookOpen className="h-4 w-4" />
            Business Context
          </CardTitle>
          <CardDescription>
            Answer these questions so the AI agent understands your business — not just
            your database schema. Answers are used on every analytical query.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Section 1 — About Your Company */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <SectionHeader title="About Your Company" saved={companySaved} />
          <TextField
            label="What does your company do?"
            hint="A one-sentence description of your business."
            value={fields.company_description}
            placeholder="We are a fashion e-commerce retailer selling direct-to-consumer online."
            onChange={set("company_description")}
            multiline
          />
          <SelectField
            label="Business model"
            hint="How do you sell to customers?"
            value={fields.business_model}
            options={BUSINESS_MODELS}
            placeholder="Select a model…"
            onChange={set("business_model")}
          />
        </CardContent>
      </Card>

      {/* Section 2 — Data Definitions */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <SectionHeader title="Data Definitions" saved={dataSaved} />
          <TextField
            label="How do you define &quot;revenue&quot;?"
            hint="Tell the AI which orders/rows count as revenue. Include any status filters."
            value={fields.revenue_definition}
            placeholder="Gross sales net of returns — exclude orders where status = 'returned'."
            onChange={set("revenue_definition")}
          />
          <TextField
            label="How do you define a churned customer?"
            hint="The time window or condition that marks a customer as lost."
            value={fields.churn_definition}
            placeholder="A customer with no purchase in the last 180 days."
            onChange={set("churn_definition")}
          />
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Fiscal year start"
              hint="When does your financial year begin?"
              value={fields.fiscal_year_start}
              options={FISCAL_MONTHS}
              placeholder="Select month…"
              onChange={set("fiscal_year_start")}
            />
            <SelectField
              label="Reporting currency"
              hint="Primary currency for financial queries."
              value={fields.currency}
              options={CURRENCIES}
              placeholder="Select currency…"
              onChange={set("currency")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Business Rules */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <SectionHeader title="Business Rules" saved={rulesSaved} />
          <TextField
            label="Are there records you always exclude?"
            hint="Test accounts, internal orders, deleted rows, etc."
            value={fields.exclusions}
            placeholder="Exclude test accounts (email LIKE '%@test.com') and orders with status = 'cancelled'."
            onChange={set("exclusions")}
          />
          <TextField
            label="Anything else the AI should know? (optional)"
            hint="Edge cases, terminology, regional specifics, or data quirks."
            value={fields.additional_context}
            placeholder="Our 'users' table includes both customers and internal staff. Staff have role = 'admin'."
            onChange={set("additional_context")}
            multiline
          />
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-2 pb-2">
        <Button onClick={handleSave} disabled={isSaving} size="sm">
          {isSaving
            ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Saving…</>
            : "Save Business Context"
          }
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Prepended to the analyst agent&apos;s system prompt on every request.
        </p>
      </div>
    </div>
  );
}

// ─── Token usage tab ──────────────────────────────────────────────────────────

const CONTEXT_LABELS: Record<string, string> = {
  discovery: "Discovery",
  agent: "Chat",
  chat: "Chat",
  communication_agent: "Meeting",
};

const CONTEXT_COLORS: Record<string, string> = {
  discovery: "bg-primary/70",
  agent: "bg-blue-500/70",
  chat: "bg-blue-500/70",
  communication_agent: "bg-violet-500/70",
};

function TokenUsageTab() {
  const { data: usage, isLoading } = useUsage();
  const { data: calls, isLoading: callsLoading } = useUsageCalls();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[96px] rounded-xl" />
        <Skeleton className="h-[140px] rounded-xl" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    );
  }

  const total = usage?.total_tokens ?? 0;
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;

  if (total === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <BrainCircuit className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">No tokens recorded yet</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              Run a discovery or send a chat message to start tracking usage.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const inputPct = total > 0 ? (input / total) * 100 : 0;

  // Build by-context rows from all non-zero contexts
  const byContext = usage?.by_context ?? {};
  const contextRows = (Object.entries(byContext) as [string, number][])
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-4">
      {/* Overview card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4" />
            Overview
          </CardTitle>
          <CardDescription>Cumulative LLM token consumption across all calls.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 divide-x">
            {[
              { label: "Total tokens", value: formatTokens(total) },
              { label: "Prompt (input)", value: formatTokens(input) },
              { label: "Completion (output)", value: formatTokens(output) },
            ].map(({ label, value }) => (
              <div key={label} className="px-4 first:pl-0 last:pr-0 text-center">
                <p className="text-2xl font-bold tracking-tight">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Input {inputPct.toFixed(0)}%</span>
              <span>Output {(100 - inputPct).toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden flex">
              <div className="h-full bg-primary/70 transition-all" style={{ width: `${inputPct}%` }} />
              <div className="h-full bg-blue-500/70 transition-all flex-1" />
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-primary/70" />Prompt</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500/70" />Completion</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* By-context breakdown */}
      {contextRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By context</CardTitle>
            <CardDescription>Tokens broken down by where they were consumed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {contextRows.map(([ctx, value]) => {
              const pct = total > 0 ? (value / total) * 100 : 0;
              const color = CONTEXT_COLORS[ctx] ?? "bg-muted-foreground/50";
              const label = CONTEXT_LABELS[ctx] ?? ctx;
              return (
                <div key={ctx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-block h-2 w-2 rounded-sm", color)} />
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{ctx}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-xs">{pct.toFixed(0)}%</span>
                      <span className="font-bold tabular-nums">{formatTokens(value)}</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Call log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Call log</CardTitle>
          <CardDescription>Every LLM call recorded, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {callsLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : !calls?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No calls recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Time</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Context</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Provider</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Model</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Input</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Output</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {calls.map((call) => (
                    <tr key={call.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(call.created_at), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                          call.context === "discovery" ? "bg-primary/10 text-primary" :
                          call.context === "communication_agent" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" :
                          "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        )}>
                          {CONTEXT_LABELS[call.context] ?? call.context}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">{call.provider}</td>
                      <td className="px-4 py-2.5 font-mono text-muted-foreground truncate max-w-[180px]">{call.model}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{call.input_tokens.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{call.output_tokens.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{call.total_tokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Provider card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  isActive,
  savedConfig,
  onSaved,
}: {
  provider: (typeof PROVIDERS)[number];
  isActive: boolean;
  savedConfig: { model: string | null; api_key_set: boolean } | undefined;
  onSaved: () => void;
}) {
  const saveMutation = useSaveProvider();
  const activateMutation = useActivateProvider();
  const testMutation = useTestLlm();

  const presetModels = provider.models;
  const initialModel = savedConfig?.model ?? (presetModels[0] || "");
  const isPreset = presetModels.includes(initialModel);

  const [model, setModel] = useState(isPreset ? initialModel : presetModels[0] ?? "");
  const [customModel, setCustomModel] = useState(!isPreset ? initialModel : "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const effectiveModel = presetModels.length > 0 ? model : customModel;

  async function handleSave() {
    if (!effectiveModel) { toast.error("Enter a model name."); return; }
    if (!apiKey && !savedConfig?.api_key_set && provider.id !== "ollama") {
      toast.error("Enter your API key."); return;
    }
    try {
      await saveMutation.mutateAsync({
        provider: provider.id,
        model: effectiveModel,
        api_key: apiKey || undefined,
      });
      toast.success(`${provider.label} config saved.`);
      setApiKey("");
      onSaved();
    } catch {
      toast.error("Failed to save.");
    }
  }

  async function handleActivate() {
    try {
      await activateMutation.mutateAsync({ provider: provider.id });
      toast.success(`${provider.label} is now the active provider.`);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to activate.");
    }
  }

  async function handleTest() {
    try {
      const result = await testMutation.mutateAsync();
      if (result.ok) toast.success(`Connected — ${result.model} in ${result.latency_ms}ms`);
      else toast.error(result.error ?? "Connection failed");
    } catch { toast.error("Test failed."); }
  }

  const hasSavedConfig = Boolean(savedConfig?.model);
  /** Active switch: on when this provider is active; others can turn it on if configured. Active card cannot turn off. */
  const switchDisabled =
    activateMutation.isPending ||
    (!isActive && !hasSavedConfig) ||
    isActive;

  const isSaving = saveMutation.isPending;
  const isActivating = activateMutation.isPending;

  function handleActiveToggle(next: boolean) {
    if (next && !isActive && hasSavedConfig) {
      void handleActivate();
    }
  }

  return (
    <Card className={cn(
      "transition-all",
      isActive && "border-primary/50 shadow-sm ring-1 ring-primary/20"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className={cn("flex items-center gap-2 text-base", provider.color)}>
              {provider.label}
              {isActive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-wide">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </span>
              )}
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">{provider.description}</CardDescription>
          </div>
          {savedConfig?.model && !isActive && (
            <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5 shrink-0">
              Configured
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Active toggle */}
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
          <Label htmlFor={`active-${provider.id}`} className="text-xs font-medium cursor-pointer text-muted-foreground">
            {isActive ? "Active provider" : hasSavedConfig ? "Set as active" : "Save config first"}
          </Label>
          <div className="flex shrink-0 items-center gap-1.5">
            {isActivating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Switch
              id={`active-${provider.id}`}
              checked={isActive}
              disabled={switchDisabled}
              onCheckedChange={handleActiveToggle}
              aria-label={
                isActive
                  ? `${provider.label} is the active provider`
                  : hasSavedConfig
                    ? `Use ${provider.label} for discovery and chat`
                    : `${provider.label}: save configuration before activating`
              }
            />
          </div>
        </div>

        {/* Model */}
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          {presetModels.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {presetModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <Input
              placeholder="e.g. llama3, mistral, phi3"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              className="text-sm"
            />
          )}
          {savedConfig?.model && (
            <p className="text-[11px] text-muted-foreground">
              Saved: <code className="font-mono">{savedConfig.model}</code>
            </p>
          )}
        </div>

        {/* API Key */}
        {provider.id !== "ollama" && (
          <div className="space-y-1.5">
            <Label className="text-xs">
              API Key
              {savedConfig?.api_key_set && (
                <span className="ml-2 text-[11px] text-green-600 dark:text-green-400 font-normal">
                  ✓ Saved
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                placeholder={savedConfig?.api_key_set ? "Enter new key to replace" : "Paste API key…"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-9 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Test result (active provider only) */}
        {isActive && testMutation.data && (
          <div className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            testMutation.data.ok ? BANNER.success : BANNER.error,
          )}>
            {testMutation.data.ok
              ? <CheckCircle className="h-4 w-4 shrink-0" />
              : <XCircle className="h-4 w-4 shrink-0" />}
            {testMutation.data.ok
              ? `Connected — ${testMutation.data.model} in ${testMutation.data.latency_ms}ms`
              : testMutation.data.error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {isSaving ? "Saving…" : "Save"}
          </Button>

          {isActive && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testMutation.isPending || !savedConfig?.api_key_set && provider.id !== "ollama"}
              className="flex-1"
            >
              {testMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Test
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Embedding tab ────────────────────────────────────────────────────────────

function EmbeddingTab() {
  const { data: embSettings, isLoading } = useEmbeddingSettings();
  const saveMutation = useSaveEmbedding();

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  async function handleSave() {
    if (!apiKey.trim()) { toast.error("Enter an OpenAI API key."); return; }
    try {
      await saveMutation.mutateAsync({ api_key: apiKey.trim() });
      toast.success("Embedding API key saved.");
      setApiKey("");
    } catch {
      toast.error("Failed to save embedding key.");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-violet-600 dark:text-violet-400">
            <Layers className="h-4 w-4" />
            Embedding Model
          </CardTitle>
          <CardDescription>
            Used to build semantic search indexes over your discovered tables so the AI
            agent can quickly find relevant tables for any query.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="min-w-0 space-y-0.5 flex-1">
              <p className="text-xs font-medium">Model</p>
              <p className="text-sm font-mono text-muted-foreground">text-embedding-3-small</p>
            </div>
            <span className="text-[10px] border rounded-full px-2 py-0.5 text-muted-foreground shrink-0">
              1536 dims · OpenAI
            </span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              OpenAI API Key
              {embSettings?.api_key_set && (
                <span className="ml-2 text-[11px] text-green-600 dark:text-green-400 font-normal">
                  ✓ Saved
                </span>
              )}
            </Label>
            <p className="text-[11px] text-muted-foreground">
              {embSettings?.api_key_set
                ? "A key is saved. Enter a new one to replace it."
                : "Required to generate semantic embeddings during discovery. You can use a separate key from your chat provider."}
            </p>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                placeholder={embSettings?.api_key_set ? "Enter new key to replace" : "sk-…"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-9 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <span>ℹ️</span>
            <span>
              If not configured, the agent falls back to keyword-based table search.
              Semantic search improves retrieval accuracy especially for large schemas.
            </span>
          </div>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {saveMutation.isPending ? "Saving…" : "Save Key"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: settings, isLoading, refetch } = useSettings();

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-8">
          <Skeleton className="h-8 w-40" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  const activeProvider = settings?.active_provider ?? null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure LLM providers independently and switch the active one at any time.
        </p>
      </div>

      <Tabs defaultValue="llm">
        <TabsList className="mb-4">
          <TabsTrigger value="llm" className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            LLM Providers
          </TabsTrigger>
          <TabsTrigger value="embedding" className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5" />
            Embeddings
          </TabsTrigger>
          <TabsTrigger value="business" className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5" />
            Business Context
          </TabsTrigger>
          <TabsTrigger value="usage" className="flex items-center gap-2">
            <BrainCircuit className="h-3.5 w-3.5" />
            Token Usage
          </TabsTrigger>
        </TabsList>

        {/* ── LLM Providers tab ───────────────────────────────────────────── */}
        <TabsContent value="llm" className="space-y-4">
          {/* Active provider banner */}
          {activeProvider ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <p className="text-sm">
                <span className="font-medium capitalize">{activeProvider}</span>
                {" "}is the active provider — used for all discovery runs and chat.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
              <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                No provider is active. Save a configuration below to get started.
              </p>
            </div>
          )}

          {/* Provider cards — 3-col on lg, 2-col on md, 1-col on sm */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                isActive={activeProvider === p.id}
                savedConfig={settings?.providers[p.id]}
                onSaved={() => refetch()}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground px-1">
            Each provider&apos;s API key is stored encrypted in PostgreSQL and never returned to the browser.
            Switch providers anytime without losing their saved configurations.
          </p>
        </TabsContent>

        {/* ── Embeddings tab ───────────────────────────────────────────────── */}
        <TabsContent value="embedding">
          <EmbeddingTab />
        </TabsContent>

        {/* ── Business Context tab ─────────────────────────────────────────── */}
        <TabsContent value="business">
          <BusinessContextTab />
        </TabsContent>

        {/* ── Token Usage tab ──────────────────────────────────────────────── */}
        <TabsContent value="usage">
          <TokenUsageTab />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
