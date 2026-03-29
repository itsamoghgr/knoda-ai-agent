"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ChevronRight, ChevronDown, Key, Link, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCatalog } from "@/lib/hooks/use-jobs";
import { SQL_TYPE_STYLES } from "@/lib/theme";
import type { ColumnMeta, TableMeta } from "@/types/api";

function typeColor(t: string) {
  const lower = t.toLowerCase().split("(")[0].trim();
  return SQL_TYPE_STYLES[lower] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
}

function ColumnRow({ col }: { col: ColumnMeta }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-sm">
      <div className="w-5 shrink-0 flex items-center justify-center">
        {col.is_primary_key && (
          <span title="Primary key">
            <Key className="h-3.5 w-3.5 text-amber-500" />
          </span>
        )}
        {col.foreign_key_ref && (
          <span title={`FK → ${col.foreign_key_ref}`}>
            <Link className="h-3.5 w-3.5 text-blue-500" />
          </span>
        )}
      </div>
      <span className="flex-1 font-mono">{col.column_name}</span>
      <Badge variant="secondary" className={`text-xs font-mono ${typeColor(col.column_type)}`}>
        {col.column_type.toLowerCase()}
      </Badge>
      {!col.is_nullable && (
        <Badge variant="outline" className="text-xs text-muted-foreground">NOT NULL</Badge>
      )}
    </div>
  );
}

interface TreeNode {
  db: string;
  schemas: { name: string; tables: TableMeta[] }[];
}

export default function CatalogPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const { data: tables, isLoading } = useCatalog(jobId);
  const [search, setSearch] = useState("");
  const [selectedTable, setSelectedTable] = useState<TableMeta | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = tables?.filter((t) =>
    t.table_name.toLowerCase().includes(search.toLowerCase()),
  ) ?? [];

  // Build tree
  const tree: TreeNode[] = [];
  for (const t of filtered) {
    let dbNode = tree.find((n) => n.db === t.database_name);
    if (!dbNode) { dbNode = { db: t.database_name, schemas: [] }; tree.push(dbNode); }
    let schNode = dbNode.schemas.find((s) => s.name === t.schema_name);
    if (!schNode) { schNode = { name: t.schema_name, tables: [] }; dbNode.schemas.push(schNode); }
    schNode.tables.push(t);
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="flex h-full">
      {/* Left: tree */}
      <div className="w-72 shrink-0 border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search tables…" className="pl-8 h-8 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
          ) : (
            <div className="py-2">
              {tree.map(({ db, schemas }) => (
                <div key={db}>
                  <button onClick={() => toggle(db)} className="flex items-center gap-1 w-full px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:bg-muted/40">
                    {expanded.has(db) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {db}
                  </button>
                  {expanded.has(db) && schemas.map(({ name, tables: schemaTables }) => (
                    <div key={name}>
                      <button onClick={() => toggle(`${db}.${name}`)} className="flex items-center gap-1 w-full px-5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40">
                        {expanded.has(`${db}.${name}`) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {name}
                      </button>
                      {expanded.has(`${db}.${name}`) && schemaTables.map((t) => (
                        <button key={t.table_name} onClick={() => setSelectedTable(t)} className={`flex items-center justify-between w-full pl-9 pr-3 py-1.5 text-sm hover:bg-muted/60 transition-colors ${selectedTable?.table_name === t.table_name ? "bg-accent text-accent-foreground" : ""}`}>
                          <span className="truncate">{t.table_name}</span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">{t.column_count}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: columns */}
      <div className="flex-1 overflow-auto">
        {!selectedTable ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Select a table to view columns</div>
        ) : (
          <div>
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold text-lg">{selectedTable.table_name}</h2>
              <p className="text-sm text-muted-foreground">
                {selectedTable.schema_name} · {selectedTable.column_count} columns
                {selectedTable.row_estimate > 0 && ` · ~${selectedTable.row_estimate.toLocaleString()} rows`}
              </p>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                <div className="w-5 shrink-0" />
                <span className="flex-1">Column</span>
                <span>Type</span>
                <span className="w-16 text-right">Nullable</span>
              </div>
              {selectedTable.columns.map((col) => <ColumnRow key={col.column_name} col={col} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
