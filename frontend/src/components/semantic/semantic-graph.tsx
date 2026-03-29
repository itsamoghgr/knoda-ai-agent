"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { BarChart3, KeyRound, Ruler, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TABLE_TYPE_STYLES, SVG_COLORS } from "@/lib/theme";
import type { Relationship, SemanticModel } from "@/types/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_W = 210;
const NODE_H = 110;

// Hex border colours by table type — CSS vars don't resolve inside SVG
const TYPE_BORDER: Record<string, string> = {
  fact:      "#3b82f6", // blue-500
  dimension: "#8b5cf6", // violet-500
  bridge:    "#06b6d4", // cyan-500
  unknown:   "#94a3b8", // slate-400
};

const TYPE_BG: Record<string, string> = {
  fact:      "#eff6ff", // blue-50
  dimension: "#f5f3ff", // violet-50
  bridge:    "#ecfeff", // cyan-50
  unknown:   "#f8fafc", // slate-50
};

// Dark-mode equivalents used for minimap only
const TYPE_MINIMAP: Record<string, string> = {
  fact:      "#93c5fd",
  dimension: "#c4b5fd",
  bridge:    "#67e8f9",
  unknown:   "#cbd5e1",
};

// ─── Semantic node ────────────────────────────────────────────────────────────

interface SemanticNodeData {
  model: SemanticModel;
  selected: boolean;
}

function SemanticNode({ data }: NodeProps<SemanticNodeData>) {
  const { model, selected } = data;
  const borderColor = TYPE_BORDER[model.table_type] ?? TYPE_BORDER.unknown;
  const bgColor     = selected ? "#fff7ed" : (TYPE_BG[model.table_type] ?? TYPE_BG.unknown);

  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        border: `2px solid ${selected ? "#ef4444" : borderColor}`,
        borderRadius: 12,
        background: bgColor,
        boxShadow: selected
          ? "0 0 0 3px rgba(239,68,68,0.2)"
          : "0 1px 4px rgba(0,0,0,0.08)",
        padding: "10px 14px",
        cursor: "pointer",
        transition: "box-shadow 0.15s, border-color 0.15s",
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Type badge + table name */}
      <div className="flex items-center justify-between gap-1 mb-1">
        <span
          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 capitalize ${TABLE_TYPE_STYLES[model.table_type] ?? TABLE_TYPE_STYLES.unknown}`}
        >
          {model.table_type}
        </span>
        <span className="text-[10px] text-slate-400 font-mono truncate max-w-[90px]">
          {model.schema_name}
        </span>
      </div>

      <p className="font-bold text-slate-800 font-mono text-sm truncate leading-tight">
        {model.table_name}
      </p>

      {model.description && (
        <p
          className="text-[10px] text-slate-500 mt-1 leading-tight"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {model.description}
        </p>
      )}

      {/* Counts */}
      <div className="flex items-center gap-3 mt-2.5">
        {model.entities.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <KeyRound className="h-2.5 w-2.5" />
            {model.entities.length}
          </span>
        )}
        {model.dimensions.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Ruler className="h-2.5 w-2.5" />
            {model.dimensions.length}
          </span>
        )}
        {model.measures.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <BarChart3 className="h-2.5 w-2.5" />
            {model.measures.length}
          </span>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { semanticNode: SemanticNode };

// ─── Graph builder ─────────────────────────────────────────────────────────────

function buildGraph(
  models: SemanticModel[],
  relationships: Relationship[],
  selectedTable: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const modelMap = new Map(models.map((m) => [`${m.schema_name}.${m.table_name}`, m]));

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 160, nodesep: 60, marginx: 60, marginy: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const m of models) {
    const key = `${m.schema_name}.${m.table_name}`;
    g.setNode(key, { width: NODE_W, height: NODE_H });
  }

  // Only add edges where both ends have semantic models
  const validEdges = relationships.filter((r) => {
    const src = `${r.from_schema}.${r.from_table}`;
    const tgt = `${r.to_schema}.${r.to_table}`;
    return modelMap.has(src) && modelMap.has(tgt) && src !== tgt;
  });

  // Deduplicate edges (same src→tgt pair)
  const edgeSeen = new Set<string>();
  const dedupedEdges: Relationship[] = [];
  for (const r of validEdges) {
    const key = `${r.from_schema}.${r.from_table}→${r.to_schema}.${r.to_table}`;
    if (!edgeSeen.has(key)) {
      edgeSeen.add(key);
      dedupedEdges.push(r);
      g.setEdge(`${r.from_schema}.${r.from_table}`, `${r.to_schema}.${r.to_table}`);
    }
  }

  dagre.layout(g);

  const nodes: Node[] = models.map((m) => {
    const key = `${m.schema_name}.${m.table_name}`;
    const { x, y } = g.node(key);
    return {
      id: key,
      type: "semanticNode",
      data: { model: m, selected: selectedTable === key },
      position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
    };
  });

  const edges: Edge[] = dedupedEdges.map((r, i) => {
    const isExplicit = r.source === "explicit";
    const strokeColor = isExplicit ? TYPE_BORDER.fact : "#94a3b8";
    return {
      id: `e${i}`,
      source: `${r.from_schema}.${r.from_table}`,
      target: `${r.to_schema}.${r.to_table}`,
      type: "smoothstep",
      label: `${r.from_column} → ${r.to_column}`,
      labelStyle: {
        fontSize: 9,
        fontFamily: "ui-monospace, monospace",
        fill: SVG_COLORS.edgeLabel,
      },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
      labelBgPadding: [3, 6] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
        width: 12,
        height: 12,
      },
      style: {
        stroke: strokeColor,
        strokeWidth: isExplicit ? 2 : 1.5,
        strokeDasharray: isExplicit ? undefined : "5 4",
      },
    };
  });

  return { nodes, edges };
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ model, onClose }: { model: SemanticModel; onClose: () => void }) {
  return (
    <div className="absolute top-3 right-3 z-10 w-72 rounded-xl border bg-background shadow-lg overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b bg-muted/30">
        <div className="min-w-0">
          <p className="font-mono font-bold text-sm truncate">{model.table_name}</p>
          <Badge
            className={`text-[10px] mt-0.5 capitalize ${TABLE_TYPE_STYLES[model.table_type] ?? TABLE_TYPE_STYLES.unknown}`}
          >
            {model.table_type}
          </Badge>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 max-h-80 overflow-y-auto text-xs">
        {model.description && (
          <p className="text-muted-foreground leading-relaxed">{model.description}</p>
        )}
        {model.grain && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Grain:</span> {model.grain}
          </p>
        )}

        {model.entities.length > 0 && (
          <div>
            <p className="font-semibold text-amber-600 mb-1 flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> Entities
            </p>
            {model.entities.map((e) => (
              <div key={e.column_name} className="flex items-center gap-2 py-0.5">
                <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">{e.column_name}</span>
                <span className="text-muted-foreground capitalize">{e.entity_type}</span>
              </div>
            ))}
          </div>
        )}

        {model.dimensions.length > 0 && (
          <div>
            <p className="font-semibold text-violet-600 mb-1 flex items-center gap-1">
              <Ruler className="h-3 w-3" /> Dimensions
            </p>
            {model.dimensions.map((d) => (
              <div key={d.column_name} className="flex items-center gap-2 py-0.5">
                <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">{d.column_name}</span>
                <span className="text-muted-foreground">{d.dim_type}</span>
              </div>
            ))}
          </div>
        )}

        {model.measures.length > 0 && (
          <div>
            <p className="font-semibold text-blue-600 mb-1 flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> Measures
            </p>
            {model.measures.map((m) => (
              <div key={m.name} className="flex items-center gap-2 py-0.5">
                <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">{m.expr}</span>
                <span className="text-muted-foreground uppercase text-[10px]">{m.agg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface SemanticGraphProps {
  models: SemanticModel[];
  relationships: Relationship[];
}

export function SemanticGraph({ models, relationships }: SemanticGraphProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const { nodes, edges } = useMemo(
    () => buildGraph(models, relationships, selectedKey),
    [models, relationships, selectedKey],
  );

  const selectedModel = useMemo(() => {
    if (!selectedKey) return null;
    return models.find((m) => `${m.schema_name}.${m.table_name}` === selectedKey) ?? null;
  }, [selectedKey, models]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedKey((prev) => (prev === node.id ? null : node.id));
  }, []);

  const minimapNodeColor = useCallback((node: Node) => {
    const model = (node.data as SemanticNodeData).model;
    return TYPE_MINIMAP[model.table_type] ?? TYPE_MINIMAP.unknown;
  }, []);

  // Legend counts
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of models) c[m.table_type] = (c[m.table_type] ?? 0) + 1;
    return c;
  }, [models]);

  if (!models.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No semantic models to display.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Legend bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-5 py-2.5 text-xs text-muted-foreground bg-background">
        <span className="font-semibold text-foreground">{models.length} models</span>
        <span className="h-4 w-px bg-border" />
        {Object.entries(counts).map(([type, count]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: TYPE_BG[type], border: `1.5px solid ${TYPE_BORDER[type] ?? "#94a3b8"}` }}
            />
            <span className="capitalize">{type}</span>
            <span className="font-semibold text-foreground">{count}</span>
          </span>
        ))}
        <span className="h-4 w-px bg-border" />
        <span className="italic">Click a node to inspect</span>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative bg-slate-50/60 dark:bg-muted/20">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable
          nodesConnectable={false}
          onNodeClick={onNodeClick}
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#cbd5e1" gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            zoomable
            pannable
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={2}
            maskColor="rgba(248,250,252,0.7)"
          />
        </ReactFlow>

        {/* Detail panel */}
        {selectedModel && (
          <DetailPanel model={selectedModel} onClose={() => setSelectedKey(null)} />
        )}
      </div>
    </div>
  );
}
