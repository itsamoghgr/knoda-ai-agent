"use client";

/**
 * useConversations — SWR-backed hook for conversation history.
 *
 * Provides:
 *   - sessions list (auto-refreshes every 30s)
 *   - per-session transcript loader
 *   - search
 */

import { useCallback, useState } from "react";
import useSWR from "swr";
import {
  fetchSessions,
  fetchSessionMessages,
  searchConversations,
  deleteSession as apiDeleteSession,
  setSessionTitle as apiSetSessionTitle,
  type ConversationSession,
  type ConversationMessage,
} from "@/lib/api/conversations";

// ─── Session list ─────────────────────────────────────────────────────────────

export function useConversationSessions() {
  const { data, error, isLoading, mutate } = useSWR<ConversationSession[]>(
    "conversation-sessions",
    fetchSessions,
    {
      refreshInterval: 30_000,   // poll every 30s so new sessions appear
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    },
  );

  const deleteSession = useCallback(async (sessionId: string) => {
    await apiDeleteSession(sessionId);
    await mutate((prev) => prev?.filter((s) => s.session_id !== sessionId), false);
  }, [mutate]);

  const setTitle = useCallback(async (sessionId: string, title: string) => {
    await apiSetSessionTitle(sessionId, title);
    await mutate();
  }, [mutate]);

  return {
    sessions: data ?? [],
    loading: isLoading,
    error: error as Error | null,
    refresh: mutate,
    deleteSession,
    setTitle,
  };
}

// ─── Session transcript ───────────────────────────────────────────────────────

export function useSessionTranscript(sessionId: string | null) {
  const { data, error, isLoading } = useSWR<ConversationMessage[]>(
    sessionId ? `conversation-transcript-${sessionId}` : null,
    () => fetchSessionMessages(sessionId!),
    { revalidateOnFocus: false },
  );

  return {
    messages: data ?? [],
    loading: isLoading,
    error: error as Error | null,
  };
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function useConversationSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    setError(null);
    try {
      const msgs = await searchConversations(q);
      setResults(msgs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }, []);

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
    setError(null);
  }, []);

  return { query, results, searching, error, search, clear };
}
