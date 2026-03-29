"use client";

import { useCallback, useRef, useState } from "react";
import { apiUrl, authHeaders } from "@/lib/api/client";
import type { ChatMessage, ToolResult } from "@/types/api";

// Strip routing signals that may leak through from the LLM
const ROUTING_PATTERNS = ["DIRECT:", "ROUTE:analyst", "ROUTE:discovery"];
const ROUTE_TAG_RE = /<route>\s*(?:analyst|discovery)\s*<\/route>/g;

function cleanToken(token: string): string {
  let cleaned = token.replace(ROUTE_TAG_RE, "");
  for (const p of ROUTING_PATTERNS) {
    cleaned = cleaned.replaceAll(p, "");
  }
  return cleaned;
}

// ── Session ID ────────────────────────────────────────────────────────────────
// A stable UUID per chat session. Sent to the backend on every turn so the
// Redis LangGraph checkpointer can maintain conversational continuity.
// Stored in a ref (not state) — rotating it never triggers a re-render.

interface ChatStreamOptions {
  /** Reuse an existing session ID instead of generating a new one (for resuming past sessions) */
  initialSessionId?: string;
  /** Pre-populate the message list (for resuming past sessions) */
  initialMessages?: ChatMessage[];
}

export function useChatStream(jobId?: string | null, options?: ChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(options?.initialMessages ?? []);
  const [streaming, setStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(options?.initialSessionId ?? crypto.randomUUID());

  const send = useCallback(
    async (text: string) => {
      if (streaming) return;

      // Capture current messages as history BEFORE adding new ones
      const history = messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);
      setStreamingMsgId(assistantId);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Safety timeout: abort after 10 minutes to handle rate-limit retries (Anthropic can
      // retry with 18–26s backoffs across many tool calls, easily exceeding 3 minutes)
      const timeoutId = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);

      // Maps tool run_id → the ChatMessage id we inserted for that tool call
      const pendingToolCalls = new Map<string, string>();
      // Track the current status message ID so we can update/remove it
      let statusMsgId: string | null = null;
      // Silence heartbeat timer — declared here so it's accessible in finally
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        const auth = await authHeaders();
        const response = await fetch(apiUrl("/agent"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            job_id: jobId ?? null,
            message: text,
            history,
            session_id: sessionIdRef.current, // v2: enables Redis checkpointer
            channel: "chat",
          }),
          signal: ctrl.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const detail = (body as { detail?: string }).detail ?? `Server error (${response.status})`;
          throw new Error(detail);
        }
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "message";

        // Silence heartbeat: if no SSE event arrives for 8s while streaming,
        // update the status pill to show the user we're still alive (e.g. during rate-limit retries)
        function resetSilenceTimer() {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => {
            if (!statusMsgId) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === statusMsgId
                  ? { ...m, statusText: "Still working — waiting for AI provider…" }
                  : m,
              ),
            );
          }, 8_000);
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetSilenceTimer();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const raw = line.slice(5).trim();
              if (!raw) continue;

              let parsed: Record<string, unknown> | null = null;
              try {
                parsed = JSON.parse(raw);
              } catch {
                // ignore malformed data lines
              }
              if (!parsed) continue;

              if (currentEvent === "token" || (currentEvent === "message" && parsed.token)) {
                const token = cleanToken(parsed.token as string);
                if (token) {
                  // Remove status message when real content arrives
                  if (statusMsgId) {
                    setMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
                    statusMsgId = null;
                  }
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: m.content + token } : m,
                    ),
                  );
                }
              } else if (currentEvent === "status") {
                // Agentic progress indicator — insert or update a transient status message
                const statusText = parsed.text as string;
                if (statusText) {
                  if (statusMsgId) {
                    // Update existing status message
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === statusMsgId ? { ...m, statusText } : m,
                      ),
                    );
                  } else {
                    // Insert a new status message before the assistant placeholder
                    const newId = crypto.randomUUID();
                    statusMsgId = newId;
                    setMessages((prev) => {
                      const idx = prev.findIndex((m) => m.id === assistantId);
                      const statusMsg: ChatMessage = {
                        id: newId,
                        role: "status",
                        content: "",
                        timestamp: new Date(),
                        statusText,
                      };
                      if (idx === -1) return [...prev, statusMsg];
                      return [...prev.slice(0, idx), statusMsg, ...prev.slice(idx)];
                    });
                  }
                }
              } else if (currentEvent === "tool_call") {
                // Seal any accumulated assistant text as a "thinking" message, then reset
                setMessages((prev) => {
                  const curr = prev.find((m) => m.id === assistantId);
                  if (!curr?.content?.trim()) return prev;
                  const thinkingMsg: ChatMessage = {
                    ...curr,
                    id: crypto.randomUUID(),
                    role: "thinking",
                  };
                  const cleared = prev.map((m) =>
                    m.id === assistantId ? { ...m, content: "" } : m,
                  );
                  const idx = cleared.findIndex((m) => m.id === assistantId);
                  return [...cleared.slice(0, idx), thinkingMsg, ...cleared.slice(idx)];
                });

                // Insert a new tool message right before the (empty) assistant placeholder
                const toolMsgId = crypto.randomUUID();
                const runId = parsed.id as string;
                pendingToolCalls.set(runId, toolMsgId);

                const toolMsg: ChatMessage = {
                  id: toolMsgId,
                  role: "tool",
                  content: "",
                  timestamp: new Date(),
                  toolName: (parsed.name as string) ?? "run_sql",
                  toolInput: (parsed.input as string) ?? "",
                  isLoading: true,
                  toolResult: null,
                };

                setMessages((prev) => {
                  // Insert before the assistant placeholder
                  const idx = prev.findIndex((m) => m.id === assistantId);
                  if (idx === -1) return [...prev, toolMsg];
                  return [...prev.slice(0, idx), toolMsg, ...prev.slice(idx)];
                });
              } else if (currentEvent === "tool_result") {
                const runId = parsed.id as string;
                const toolMsgId = pendingToolCalls.get(runId);
                if (toolMsgId) {
                              const result: ToolResult = {
                    rows: (parsed.rows as Record<string, unknown>[]) ?? [],
                    truncated: (parsed.truncated as boolean) ?? false,
                    text: (parsed.text as string | null) ?? null,
                    error: (parsed.error as string | null) ?? null,
                  };
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === toolMsgId ? { ...m, isLoading: false, toolResult: result } : m,
                    ),
                  );
                  pendingToolCalls.delete(runId);
                }
              } else if (currentEvent === "error" && parsed.message) {
                throw new Error(parsed.message as string);
              }

              // Reset event type after data line
              currentEvent = "message";
            } else if (line === "") {
              // blank line resets SSE event type
              currentEvent = "message";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: (m.content || "") + "\n\nSorry, something went wrong. Please try again." }
                : m,
            ),
          );
        }
      } finally {
        clearTimeout(timeoutId);
        if (silenceTimer) clearTimeout(silenceTimer);
        // Remove any lingering status messages
        setMessages((prev) => prev.filter((m) => m.role !== "status"));
        // Replace the assistant placeholder if it ended with no content at all
        // (e.g. stream was interrupted before any tokens arrived)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && !m.content.trim()
              ? { ...m, content: "*(No response received — please try again)*" }
              : m,
          ),
        );
        setStreaming(false);
        setStreamingMsgId(null);
        abortRef.current = null;
      }
    },
    [jobId, streaming, messages],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    setMessages([]);
    setStreaming(false);
    setStreamingMsgId(null);
    sessionIdRef.current = crypto.randomUUID(); // v2: start a fresh session
  }, []);

  // Expose sessionId so callers can highlight the active session in history
  const sessionId = sessionIdRef.current;

  return { messages, streaming, streamingMsgId, send, stop, clear, sessionId };
}
