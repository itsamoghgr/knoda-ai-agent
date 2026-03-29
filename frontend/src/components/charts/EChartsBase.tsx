"use client";

/**
 * EChartsBase — single reusable ECharts wrapper for Luray.ai
 *
 * Handles: initialization, theme application, resize observation,
 * dark mode switching, loading overlay, click event forwarding, cleanup.
 */

import { useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";
import type { EChartsOption } from "echarts";
import { defaultChartOption } from "@/lib/echarts-theme";

export interface EChartsBaseProps {
  option: EChartsOption;
  height?: number | string;
  loading?: boolean;
  className?: string;
  onEvents?: {
    click?: (params: unknown) => void;
    legendselectchanged?: (params: unknown) => void;
    datazoom?: (params: unknown) => void;
    [key: string]: ((params: unknown) => void) | undefined;
  };
}

export default function EChartsBase({
  option,
  height = "100%",
  loading = false,
  className = "",
  onEvents,
}: EChartsBaseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  // ── Initialize ECharts ──────────────────────────────────────────────────────
  const initChart = useCallback(async () => {
    if (!containerRef.current) return;

    const echarts = await import("echarts");

    // Dispose existing instance before re-init (e.g. container changed)
    if (chartRef.current) {
      chartRef.current.dispose();
    }

    chartRef.current = echarts.init(containerRef.current, null, {
      renderer: "canvas",
    });

    return chartRef.current;
  }, []);

  // ── Mount & cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const applyOption = (chart: ReturnType<typeof chartRef.current>) => {
      const merged = {
        ...defaultChartOption(isDark),
        ...option,
        // Merge tooltip so our defaults aren't lost
        tooltip: {
          ...defaultChartOption(isDark).tooltip,
          ...(option.tooltip as object | undefined),
        },
      };
      chart.setOption(merged, { notMerge: true });
    };

    initChart().then((chart) => {
      if (!chart || !mounted) return;

      applyOption(chart);

      // Attach events
      if (onEvents) {
        for (const [event, handler] of Object.entries(onEvents)) {
          if (handler) chart.on(event, handler);
        }
      }

      // If container had 0 height at init (e.g. inside CSS grid that hasn't
      // computed row heights yet), re-initialize once the container has real size.
      const container = containerRef.current;
      if (container && (container.offsetWidth === 0 || container.offsetHeight === 0)) {
        const reinitObs = new ResizeObserver((entries) => {
          if (!mounted) return;
          const rect = entries[0]?.contentRect;
          if (rect && rect.width > 0 && rect.height > 0) {
            reinitObs.disconnect();
            initChart().then((newChart) => {
              if (!newChart || !mounted) return;
              applyOption(newChart);
              if (onEvents) {
                for (const [event, handler] of Object.entries(onEvents)) {
                  if (handler) newChart.on(event, handler);
                }
              }
            });
          }
        });
        reinitObs.observe(container);
      }
    });

    return () => {
      mounted = false;
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once

  // ── Update option when data changes ────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const merged = {
      ...defaultChartOption(isDark),
      ...option,
      tooltip: {
        ...defaultChartOption(isDark).tooltip,
        ...(option.tooltip as object | undefined),
      },
    };

    chart.setOption(merged, { notMerge: true });
  }, [option, isDark]);

  // ── Update events when onEvents changes ────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;

    // Re-bind all events (simple approach: off all, re-add)
    chart.off("click");
    chart.off("legendselectchanged");
    chart.off("datazoom");

    for (const [event, handler] of Object.entries(onEvents)) {
      if (handler) chart.on(event, handler);
    }
  }, [onEvents]);

  // ── Respond to container resize ────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const obs = new ResizeObserver((entries) => {
      const chart = chartRef.current;
      if (!chart) return;
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        chart.resize();
      }
    });
    obs.observe(container);

    return () => obs.disconnect();
  }, []);

  const heightStyle =
    typeof height === "number" ? `${height}px` : height;

  return (
    <div className={`relative h-full w-full ${className}`} style={{ height: heightStyle }}>
      {/* ECharts canvas container */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ opacity: loading ? 0.6 : 1, transition: "opacity 200ms" }}
      />

      {/* Loading overlay — dims chart but keeps old data visible */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
