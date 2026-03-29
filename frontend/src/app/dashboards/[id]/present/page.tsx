"use client";

/**
 * Presentation Mode — fullscreen dashboard view with AI Communication Agent.
 *
 * The page owns the session lifecycle only:
 *   - Creates a Communication Agent session on mount (POST /present/{id}/session)
 *   - Passes sessionId to VoiceInterface
 *   - Cleans up the session on unmount (DELETE /present/session/{id})
 *
 * All audio (narration + Q&A), STT, TTS, and session history are handled
 * inside VoiceInterface. This page has zero AI or audio logic.
 */

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2, Maximize2, X } from "lucide-react";
import { useDashboard, useDatasetData } from "@/lib/hooks/use-charts";
import ChartRenderer from "@/components/charts/ChartRenderer";
import VoiceInterface from "@/components/presentation/VoiceInterface";
import { authHeaders } from "@/lib/api/client";
import type { DashboardChart } from "@/types/api";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const MARGIN = 16;
const MIN_ROW_HEIGHT = 60;

// Dynamic import of GridLayout (same as dashboard page)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridLayout: any = dynamic(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("react-grid-layout")) as any;
    return { default: mod.default ?? mod };
  },
  { ssr: false },
);

// ── Read-only chart widget ────────────────────────────────────────────────────

function PresentChartWidget({ dc }: { dc: DashboardChart }) {
  const { data: dataResult, isLoading } = useDatasetData(dc.dataset_id);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(200);

  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    setChartHeight(el.getBoundingClientRect().height || 200);
    const obs = new ResizeObserver(([entry]) => {
      setChartHeight(entry.contentRect.height || 200);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex shrink-0 items-center px-4 py-2.5">
        <span className="truncate text-sm font-semibold">{dc.chart_name}</span>
      </div>
      <div className="mx-4 shrink-0 border-t" />
      <div
        ref={chartAreaRef}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3"
      >
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : dataResult?.error ? (
          <div className="flex flex-1 items-center justify-center text-xs text-destructive">
            {dataResult.error}
          </div>
        ) : dataResult ? (
          <ChartRenderer
            chartType={dc.chart_type}
            config={dc.config ?? {}}
            columns={dataResult.columns}
            rows={dataResult.rows}
            height={chartHeight}
          />
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PresentationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: dashboard, isLoading } = useDashboard(id);

  // ── Grid sizing (same pattern as dashboard page) ──────────────────────────
  const [gridWidth, setGridWidth] = useState(1200);
  const [containerHeight, setContainerHeight] = useState(600);

  const gridContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const ph = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const pv = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    setGridWidth((el.clientWidth - ph) || 1200);
    setContainerHeight((el.clientHeight - pv) || 600);
    const obs = new ResizeObserver(([entry]) => {
      setGridWidth(entry.contentRect.width);
      setContainerHeight(entry.contentRect.height);
    });
    obs.observe(el);
  }, []);

  // ── Layout from DB positions ──────────────────────────────────────────────
  const gridLayout = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.charts.map((dc) => ({
      i: dc.chart_id,
      x: dc.grid_x,
      y: dc.grid_y,
      w: dc.grid_w,
      h: dc.grid_h,
      static: true, // read-only — no drag/resize
    }));
  }, [dashboard]);

  const totalGridRows = useMemo(() => {
    if (gridLayout.length === 0) return 1;
    return Math.max(...gridLayout.map((l) => l.y + l.h));
  }, [gridLayout]);

  const rowHeight = useMemo(() => {
    const totalMargins = (totalGridRows + 1) * MARGIN;
    const available = containerHeight - totalMargins;
    return Math.max(MIN_ROW_HEIGHT, Math.floor(available / totalGridRows));
  }, [containerHeight, totalGridRows]);

  // ── Session lifecycle — owned by this page, passed down to VoiceInterface ──
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  // userReady: true after the user taps "Start" — provides browser gesture for audio autoplay
  const [userReady, setUserReady] = useState(false);
  // Guard against React 18 StrictMode double-invoke
  const sessionStartedRef = useRef(false);
  // iOS audio unlock: play() this element synchronously inside the user gesture
  // to set WebKit's page-level audio permission flag before any await occurs.
  const audioUnlockRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!dashboard || sessionStartedRef.current) return;
    sessionStartedRef.current = true;

    authHeaders().then((auth) =>
      fetch(`${API_BASE}/present/${id}/session`, { method: "POST", headers: auth })
        .then((r) => {
          if (!r.ok) return r.json().then((b) => Promise.reject(b.detail ?? "Session creation failed"));
          return r.json();
        })
        .then(({ session_id }: { session_id: string }) => {
          setSessionId(session_id);
        })
        .catch((err: unknown) => {
          setSessionError(typeof err === "string" ? err : "Could not start AI session");
        })
    );
  }, [dashboard, id, retryCount]);

  // Clean up session when leaving presentation
  useEffect(() => {
    return () => {
      if (sessionId) {
        authHeaders().then((auth) =>
          fetch(`${API_BASE}/present/session/${sessionId}`, { method: "DELETE", headers: auth }).catch(() => {})
        );
      }
    };
  }, [sessionId]);

  // ── Fullscreen helper ─────────────────────────────────────────────────────
  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // fixed inset-0 z-50 covers the sidebar and app header entirely
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">
            {isLoading ? "Loading..." : (dashboard?.name ?? "Presentation")}
          </span>
          {sessionError && (
            <span className="text-xs text-destructive">{sessionError}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleFullscreen}
            aria-label="Toggle fullscreen"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => router.push(`/dashboards/${id}`)}
            aria-label="Exit presentation"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Charts grid */}
      <div
        ref={gridContainerRef}
        className="flex-1 overflow-y-auto bg-muted/30 p-4"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !dashboard || dashboard.charts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No charts on this dashboard
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={gridLayout}
            cols={12}
            rowHeight={rowHeight}
            width={gridWidth}
            isDraggable={false}
            isResizable={false}
            margin={[MARGIN, MARGIN]}
          >
            {dashboard.charts.map((dc) => (
              <div key={dc.chart_id}>
                <PresentChartWidget dc={dc} />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {/* Voice interface — handles narration + Q&A + history */}
      {/* onAudioRef receives the persistent HTMLAudioElement created inside VoiceInterface.
          We call .play() on it synchronously in the Start button gesture to unlock
          WebKit's audio gate on iOS before any async boundaries are crossed. */}
      <VoiceInterface
        sessionId={userReady ? sessionId : null}
        onAudioRef={(el) => { audioUnlockRef.current = el; }}
      />

      {/* Start overlay — browser requires a user gesture before audio can autoplay */}
      {!userReady && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
          {sessionError ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-destructive">{sessionError}</p>
              <button
                onClick={() => {
                  sessionStartedRef.current = false;
                  setSessionError(null);
                  setRetryCount((c) => c + 1);
                }}
                className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Try again
              </button>
            </div>
          ) : !sessionId ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Preparing presentation…</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold">Ready to present</p>
              <p className="text-sm text-muted-foreground">The AI will narrate this dashboard</p>
              <button
                onClick={() => {
                  // Unlock WebKit audio gate synchronously before any await.
                  // Must be the first line — iOS consumes the gesture token immediately.
                  audioUnlockRef.current?.play().catch(() => {});
                  setUserReady(true);
                }}
                className="mt-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow transition-opacity hover:opacity-90"
              >
                Start Presentation
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
