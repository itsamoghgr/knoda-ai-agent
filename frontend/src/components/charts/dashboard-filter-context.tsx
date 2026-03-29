"use client";

/**
 * DashboardFilterContext
 *
 * Provides cross-filter state for an entire dashboard.
 * When a user clicks a data point on one chart, a filter is set here.
 * All other ChartWidgets read this context and apply matching filters
 * to their snapshot rows in-memory — no re-fetching needed.
 */

import { createContext, useCallback, useContext, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActiveFilter {
  /** The column / dimension being filtered */
  dimension: string;
  /** The value to match */
  value: unknown;
  /** Chart that set this filter (excluded from filtering itself) */
  sourceChartId: string;
}

interface DashboardFilterContextValue {
  filters: ActiveFilter[];
  /** Add or replace a filter for a given dimension */
  setFilter: (f: ActiveFilter) => void;
  /** Remove the filter for a specific dimension */
  clearFilter: (dimension: string) => void;
  /** Remove ALL active filters */
  clearAll: () => void;
  /**
   * Apply active filters to a set of rows, excluding filters originating
   * from this chart (so the source chart itself is never filtered).
   */
  applyFilters: (
    rows: Record<string, unknown>[],
    thisChartId: string,
  ) => Record<string, unknown>[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DashboardFilterContext = createContext<DashboardFilterContextValue>({
  filters: [],
  setFilter: () => {},
  clearFilter: () => {},
  clearAll: () => {},
  applyFilters: (rows) => rows,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DashboardFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [filters, setFilters] = useState<ActiveFilter[]>([]);

  const setFilter = useCallback((f: ActiveFilter) => {
    setFilters((prev) => {
      // Toggle off if clicking the same value again
      const exists = prev.find(
        (p) => p.dimension === f.dimension && String(p.value) === String(f.value),
      );
      if (exists) {
        return prev.filter((p) => p.dimension !== f.dimension);
      }
      // Replace any existing filter for this dimension
      return [...prev.filter((p) => p.dimension !== f.dimension), f];
    });
  }, []);

  const clearFilter = useCallback((dimension: string) => {
    setFilters((prev) => prev.filter((f) => f.dimension !== dimension));
  }, []);

  const clearAll = useCallback(() => setFilters([]), []);

  const applyFilters = useCallback(
    (rows: Record<string, unknown>[], thisChartId: string) => {
      // Only apply filters set by OTHER charts
      const applicableFilters = filters.filter(
        (f) => f.sourceChartId !== thisChartId,
      );
      if (!applicableFilters.length) return rows;

      return rows.filter((row) =>
        applicableFilters.every((f) => {
          const cell = row[f.dimension];
          // Loose equality so numbers and strings match
          return String(cell) === String(f.value);
        }),
      );
    },
    [filters],
  );

  return (
    <DashboardFilterContext.Provider
      value={{ filters, setFilter, clearFilter, clearAll, applyFilters }}
    >
      {children}
    </DashboardFilterContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDashboardFilters() {
  return useContext(DashboardFilterContext);
}
