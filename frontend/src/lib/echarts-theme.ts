/**
 * ECharts theme configuration for Luray.ai
 *
 * SERIES COLORS: Fixed 8-color accessible palette — identical in light and dark mode.
 * These never change. Multi-color charts always look great regardless of theme.
 *
 * CHROME (adapts to theme): background, grid lines, axis text, tooltips.
 */

// ─── Series color palette ─────────────────────────────────────────────────────
// Fixed — same in light and dark mode. Accessible, no adjacent red/green.

export const CHART_PALETTE = [
  "#6366f1", // indigo     (brand primary)
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#a855f7", // violet
  "#10b981", // emerald
  "#f43f5e", // rose
  "#64748b", // slate
] as const;

// ─── Theme builder ────────────────────────────────────────────────────────────

export function getEChartsTheme(isDark: boolean) {
  const axisText = isDark ? "#9ca3af" : "#6b7280";
  const gridLine = isDark ? "#374151" : "#e5e7eb";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipBorder = isDark ? "#374151" : "#e5e7eb";
  const tooltipText = isDark ? "#f9fafb" : "#111827";

  return {
    // Series colors — never change between themes
    color: CHART_PALETTE,

    // Background — always transparent (card bg shows through)
    backgroundColor: "transparent",

    // Text
    textStyle: {
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
      color: axisText,
      fontSize: 11,
    },

    // Title (rarely used — chart tiles have their own title)
    title: {
      textStyle: { color: axisText, fontSize: 13, fontWeight: 500 },
    },

    // Legend
    legend: {
      textStyle: { color: axisText, fontSize: 11 },
      inactiveColor: isDark ? "#4b5563" : "#d1d5db",
      pageIconColor: axisText,
      pageTextStyle: { color: axisText },
    },

    // Tooltip
    tooltip: {
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      textStyle: { color: tooltipText, fontSize: 12 },
      extraCssText: `
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        border-radius: 8px;
      `,
    },

    // Axis (applied to all xAxis/yAxis unless overridden per chart)
    categoryAxis: {
      axisLine: { lineStyle: { color: gridLine } },
      axisTick: { lineStyle: { color: gridLine } },
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine, type: "dashed" } },
    },
    logAxis: {
      axisLabel: { color: axisText },
      splitLine: { lineStyle: { color: gridLine } },
    },
    timeAxis: {
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine, type: "dashed" } },
    },

    // Grid
    grid: {
      left: "5%",
      right: "3%",
      top: 12,
      bottom: 28,
      containLabel: true,
    },

    // Animation defaults
    animation: true,
    animationDuration: 400,
    animationEasing: "cubicOut" as const,
    animationDurationUpdate: 300,
  };
}

// ─── Default chart option overrides (merged into every option) ────────────────

export function defaultChartOption(isDark: boolean) {
  const theme = getEChartsTheme(isDark);
  return {
    color: theme.color,
    backgroundColor: theme.backgroundColor,
    textStyle: theme.textStyle,
    tooltip: theme.tooltip,
    legend: theme.legend,
    animation: theme.animation,
    animationDuration: theme.animationDuration,
    animationEasing: theme.animationEasing,
    animationDurationUpdate: theme.animationDurationUpdate,
  };
}
