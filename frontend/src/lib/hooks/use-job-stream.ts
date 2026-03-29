"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api/client";
import type { ProgressEvent } from "@/types/api";
import { jobKeys } from "./use-jobs";

export type StreamEvent = ProgressEvent & { _type: "progress" } | { _type: "done" } | { _type: "error"; message: string };

export function useJobStream(
  jobId: string,
  enabled: boolean,
  onEvent: (event: StreamEvent) => void,
) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !jobId) return;

    const es = new EventSource(apiUrl(`/jobs/${jobId}/stream`));
    esRef.current = es;

    es.addEventListener("progress", (e) => {
      try {
        const data: ProgressEvent = JSON.parse(e.data);
        onEventRef.current({ ...data, _type: "progress" });
      } catch {
        // ignore malformed events
      }
    });

    es.addEventListener("done", () => {
      onEventRef.current({ _type: "done" });
      qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      qc.invalidateQueries({ queryKey: jobKeys.all });
      es.close();
    });

    es.addEventListener("error", (e) => {
      let message = "Stream error";
      try {
        message = JSON.parse((e as MessageEvent).data).message ?? message;
      } catch {
        // ignore
      }
      onEventRef.current({ _type: "error", message });
      es.close();
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, enabled, qc]);
}
