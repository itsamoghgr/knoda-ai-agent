"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Download, ChevronDown, ChevronUp, KeyRound, Ruler, BarChart3, List, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSemanticLayer, useSemanticYaml, useRelationships } from "@/lib/hooks/use-jobs";
import { downloadSemanticYaml } from "@/lib/api/catalog";
import { TABLE_TYPE_STYLES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { SemanticGraph } from "@/components/semantic/semantic-graph";
import type { SemanticModel } from "@/types/api";

type ViewMode = "list" | "graph";

// ─── YAML preview ─────────────────────────────────────────────────────────────

function YamlPreview({ yaml }: { yaml: string }) {
  return (
    <pre className="overflow-auto rounded-xl border bg-muted p-5 text-sm font-mono leading-relaxed max-h-[500px]">
      {yaml}
    </pre>
  );
}

// ─── Section block ─────────────────────────────────────────────────────────────

function SectionBlock({
  title,
  accent,
  icon: Icon,
  children,
}: {
  title: string;
  accent: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border-l-[3px] bg-muted/30 overflow-hidden", accent)}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/50">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="grid grid-cols-[120px_180px_1fr] gap-4 px-4 py-1.5 text-xs font-medium text-muted-foreground border-b">
        <span>Type</span>
        <span>Column / Expression</span>
        <span>Description</span>
      </div>
      {children}
    </div>
  );
}

// ─── Model card ────────────────────────────────────────────────────────────────

function ModelCard({ model }: { model: SemanticModel }) {
  const [open, setOpen] = useState(false);

  const entityCount    = model.entities.length;
  const dimensionCount = model.dimensions.length;
  const measureCount   = model.measures.length;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <button
        className="w-full text-left px-5 py-4 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-lg font-mono font-semibold">{model.table_name}</span>
              <Badge className={`text-xs capitalize ${TABLE_TYPE_STYLES[model.table_type] ?? TABLE_TYPE_STYLES.unknown}`}>
                {model.table_type}
              </Badge>
              <span className="text-sm text-muted-foreground font-mono">{model.schema_name}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed line-clamp-2">
              {model.description}
            </p>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {entityCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="h-3 w-3" />
                  {entityCount} {entityCount === 1 ? "entity" : "entities"}
                </span>
              )}
              {dimensionCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Ruler className="h-3 w-3" />
                  {dimensionCount} {dimensionCount === 1 ? "dimension" : "dimensions"}
                </span>
              )}
              {measureCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <BarChart3 className="h-3 w-3" />
                  {measureCount} {measureCount === 1 ? "measure" : "measures"}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 mt-1 text-muted-foreground">
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t px-5 py-4 space-y-4 bg-muted/10">
          {entityCount > 0 && (
            <SectionBlock title="Entities" accent="border-amber-400" icon={KeyRound}>
              {model.entities.map((e, i) => (
                <div
                  key={e.column_name}
                  className={cn(
                    "grid grid-cols-[120px_180px_1fr] gap-4 px-4 py-2.5 text-sm items-start",
                    i % 2 === 0 ? "bg-background/60" : "bg-transparent",
                  )}
                >
                  <Badge variant="outline" className="text-xs w-fit">{e.entity_type}</Badge>
                  <span className="font-mono text-sm">{e.column_name}</span>
                  <span className="text-muted-foreground leading-relaxed">{e.description}</span>
                </div>
              ))}
            </SectionBlock>
          )}

          {dimensionCount > 0 && (
            <SectionBlock title="Dimensions" accent="border-violet-400" icon={Ruler}>
              {model.dimensions.map((d, i) => (
                <div
                  key={d.column_name}
                  className={cn(
                    "grid grid-cols-[120px_180px_1fr] gap-4 px-4 py-2.5 text-sm items-start",
                    i % 2 === 0 ? "bg-background/60" : "bg-transparent",
                  )}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs w-fit">{d.dim_type}</Badge>
                    {d.time_granularity && (
                      <Badge variant="secondary" className="text-xs w-fit">{d.time_granularity}</Badge>
                    )}
                  </div>
                  <span className="font-mono text-sm">{d.column_name}</span>
                  <span className="text-muted-foreground leading-relaxed">{d.description}</span>
                </div>
              ))}
            </SectionBlock>
          )}

          {measureCount > 0 && (
            <SectionBlock title="Measures" accent="border-blue-400" icon={BarChart3}>
              {model.measures.map((m, i) => (
                <div
                  key={m.name}
                  className={cn(
                    "grid grid-cols-[120px_180px_1fr] gap-4 px-4 py-2.5 text-sm items-start",
                    i % 2 === 0 ? "bg-background/60" : "bg-transparent",
                  )}
                >
                  <Badge variant="outline" className="text-xs font-mono w-fit">{m.agg}</Badge>
                  <span className="font-mono text-sm">{m.expr}</span>
                  <span className="text-muted-foreground leading-relaxed">{m.description}</span>
                </div>
              ))}
            </SectionBlock>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SemanticPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const { data: models, isLoading } = useSemanticLayer(jobId);
  const { data: yaml } = useSemanticYaml(jobId);
  const { data: relationships } = useRelationships(jobId);
  const [showYaml, setShowYaml] = useState(false);
  const [view, setView] = useState<ViewMode>("list");

  async function handleDownload() {
    try {
      await downloadSemanticYaml(jobId);
    } catch {
      toast.error("Failed to download YAML.");
    }
  }

  return (
    <div className={cn("flex flex-col", view === "graph" ? "h-full" : "p-6 space-y-5")}>
      {/* Header */}
      <div className={cn("flex items-center justify-between gap-4 flex-wrap", view === "graph" && "px-6 pt-5 pb-4")}>
        <div>
          <h2 className="text-xl font-semibold">Semantic Layer</h2>
          {models && (
            <p className="text-sm text-muted-foreground mt-0.5">{models.length} models generated</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                view === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
            <button
              onClick={() => setView("graph")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l",
                view === "graph"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Graph
            </button>
          </div>

          {view === "list" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowYaml(!showYaml)}>
                {showYaml ? "Hide YAML" : "Show YAML"}
              </Button>
              <Button size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1.5" /> Download YAML
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Graph view — takes full remaining height */}
      {view === "graph" && (
        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Skeleton className="h-96 w-full mx-6 rounded-xl" />
            </div>
          ) : (
            <SemanticGraph models={models ?? []} relationships={relationships ?? []} />
          )}
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <>
          {showYaml && yaml && <YamlPreview yaml={yaml} />}

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : models?.length ? (
            <div className="space-y-3">
              {models.map((model: SemanticModel) => (
                <ModelCard key={`${model.schema_name}.${model.table_name}`} model={model} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No semantic models available.</p>
          )}
        </>
      )}
    </div>
  );
}
