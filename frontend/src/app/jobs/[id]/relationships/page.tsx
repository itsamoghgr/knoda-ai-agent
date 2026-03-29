"use client";

import { useMemo, useState, useCallback } from "react";
import { useParams } from "next/navigation";
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
import { useRelationships } from "@/lib/hooks/use-jobs";
import { Skeleton } from "@/components/ui/skeleton";
import { CONF_STYLES, SVG_COLORS, getConfLevel } from "@/lib/theme";
import type { Relationship } from "@/types/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 56;

// ─── Table node ───────────────────────────────────────────────────────────────

function TableNode({ data }: NodeProps<{ schema: string; table: string }>) {
  return (
    <div
      style={{ width: NODE_W, minHeight: NODE_H }}
      className="rounded-xl border-2 border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      {/* Left = incoming FK references (target), Right = outgoing FK refs (source) */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <p className="text-[10px] text-slate-400 font-mono leading-none mb-1 truncate">
        {data.schema}
      </p>
      <p className="text-sm font-bold text-slate-800 font-mono truncate">{data.table}</p>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(relationships: Relationship[]): { nodes: Node[]; edges: Edge[] } {
  const tableSet = new Set<string>();
  for (const r of relationships) {
    tableSet.add(`${r.from_schema}.${r.from_table}`);
    tableSet.add(`${r.to_schema}.${r.to_table}`);
  }

  // Dagre: LR layout so FK child is on the left and referenced (parent) on the right.
  // This matches the Supabase schema visualizer style with left→right flow.
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 140, nodesep: 50, marginx: 50, marginy: 50 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tableSet) g.setNode(t, { width: NODE_W, height: NODE_H });
  for (const r of relationships) {
    g.setEdge(`${r.from_schema}.${r.from_table}`, `${r.to_schema}.${r.to_table}`);
  }
  dagre.layout(g);

  const nodes: Node[] = [...tableSet].map((label) => {
    const { x, y } = g.node(label);
    const dot = label.indexOf(".");
    return {
      id: label,
      type: "tableNode",
      data: { schema: label.slice(0, dot), table: label.slice(dot + 1) },
      position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
    };
  });

  const edges: Edge[] = relationships.map((rel, i) => {
    const level = getConfLevel(rel.confidence);
    const stroke = CONF_STYLES[level].stroke;
    const isInferred = rel.source === "inferred";
    const label = `${rel.from_column} → ${rel.to_column}`;

    return {
      id: `e${i}`,
      source: `${rel.from_schema}.${rel.from_table}`,
      target: `${rel.to_schema}.${rel.to_table}`,
      type: "smoothstep",
      label,
      labelStyle: {
        fontSize: 10,
        fontFamily: "ui-monospace, monospace",
        fill: SVG_COLORS.edgeLabel,
        fontWeight: 500,
      },
      // Use explicit hex/rgba — CSS vars don't resolve inside SVG fill
      labelBgStyle: { fill: SVG_COLORS.edgeLabelBg, fillOpacity: 0.95 },
      labelBgPadding: [4, 8] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: 14,
        height: 14,
      },
      style: {
        stroke,
        strokeWidth: isInferred ? 1.5 : 2.5,
        strokeDasharray: isInferred ? "6 4" : undefined,
      },
      data: { rel },
    };
  });

  return { nodes, edges };
}

// ─── Hover detail strip ───────────────────────────────────────────────────────

function HoverStrip({ rel }: { rel: Relationship }) {
  const level = getConfLevel(rel.confidence);
  const { badge } = CONF_STYLES[level];
  return (
    <div className="flex items-center gap-3 px-6 py-2 border-t bg-muted/30 text-xs animate-in fade-in duration-150">
      <span className="text-muted-foreground">Hover:</span>
      <span className="font-mono font-medium">
        {rel.from_table}.{rel.from_column}
      </span>
      <span className="text-muted-foreground">→</span>
      <span className="font-mono font-medium">
        {rel.to_table}.{rel.to_column}
      </span>
      <span className={`ml-auto rounded-full px-2 py-0.5 font-semibold ${badge}`}>
        {Math.round(rel.confidence * 100)}% confidence
      </span>
      <span className="rounded-full bg-muted text-muted-foreground px-2 py-0.5 font-medium capitalize">
        {rel.source}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RelationshipsPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const { data: relationships, isLoading } = useRelationships(jobId);
  const [hovered, setHovered] = useState<Relationship | null>(null);

  const { nodes, edges } = useMemo(
    () => buildGraph(relationships ?? []),
    [relationships],
  );

  const onEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    setHovered((edge.data as { rel: Relationship }).rel);
  }, []);
  const onEdgeMouseLeave = useCallback(() => setHovered(null), []);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!relationships?.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No relationships detected.
      </div>
    );
  }

  const inferredCount = relationships.filter((r) => r.source === "inferred").length;
  const explicitCount = relationships.length - inferredCount;
  const high = relationships.filter((r) => r.confidence >= 0.9).length;
  const med = relationships.filter((r) => r.confidence >= 0.7 && r.confidence < 0.9).length;
  const low = relationships.filter((r) => r.confidence < 0.7).length;

  return (
    <div className="flex flex-col h-full">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b px-6 py-3 text-xs text-muted-foreground bg-background">
        <span className="font-semibold text-foreground">
          {relationships.length} relationship{relationships.length !== 1 ? "s" : ""}
        </span>

        <span className="h-4 w-px bg-border" />

        {high > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: SVG_COLORS.confHigh }} />
            <span>High ≥ 0.9</span>
            <span className={`rounded-full px-1.5 font-semibold ${CONF_STYLES.high.badge}`}>
              {high}
            </span>
          </span>
        )}
        {med > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: SVG_COLORS.confMed }} />
            <span>Medium ≥ 0.7</span>
            <span className={`rounded-full px-1.5 font-semibold ${CONF_STYLES.med.badge}`}>
              {med}
            </span>
          </span>
        )}
        {low > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: SVG_COLORS.confLow }} />
            <span>Low</span>
            <span className={`rounded-full px-1.5 font-semibold ${CONF_STYLES.low.badge}`}>
              {low}
            </span>
          </span>
        )}

        <span className="h-4 w-px bg-border" />

        {explicitCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5" style={{ borderTop: `2.5px solid ${SVG_COLORS.explicitFK}`, marginTop: 1 }} />
            Explicit FK
            <span className="rounded-full px-1.5 font-semibold bg-muted text-muted-foreground">
              {explicitCount}
            </span>
          </span>
        )}
        {inferredCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5" style={{ borderTop: `2px dashed ${SVG_COLORS.inferredFK}`, marginTop: 1 }} />
            Inferred
            <span className="rounded-full px-1.5 font-semibold bg-muted text-muted-foreground">
              {inferredCount}
            </span>
          </span>
        )}

        <span className="ml-auto italic">Hover an edge to inspect</span>
      </div>

      {/* Graph */}
      <div className="flex-1 bg-muted/30">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable
          nodesConnectable={false}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#cbd5e1" gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            zoomable
            pannable
            nodeColor={SVG_COLORS.minimapNode}
            nodeStrokeColor={SVG_COLORS.minimapStroke}
            nodeStrokeWidth={2}
            maskColor="rgba(248,250,252,0.7)"
          />
        </ReactFlow>
      </div>

      {/* Hover strip */}
      {hovered && <HoverStrip rel={hovered} />}
    </div>
  );
}
