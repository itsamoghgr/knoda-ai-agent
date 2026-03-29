"use client";

/**
 * DashboardFilterBar
 *
 * Compact single-row bar below the dashboard title.
 * Shows active cross-filters as dismissible badges.
 * A "Clear all" button removes all active filters.
 * Filter state lives in DashboardFilterContext — this component is purely UI.
 */

import { X } from "lucide-react";
import { useDashboardFilters } from "./dashboard-filter-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function DashboardFilterBar() {
  const { filters, clearFilter, clearAll } = useDashboardFilters();

  if (filters.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-1.5">
      <span className="text-xs text-muted-foreground">Filtered by:</span>

      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <Badge
            key={f.dimension}
            variant="secondary"
            className="flex items-center gap-1 pl-2 pr-1 text-xs"
          >
            <span className="text-muted-foreground">{f.dimension}:</span>
            <span className="font-medium">{String(f.value)}</span>
            <button
              onClick={() => clearFilter(f.dimension)}
              className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={clearAll}
      >
        Clear all
      </Button>
    </div>
  );
}
