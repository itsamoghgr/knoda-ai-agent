/**
 * Conversations API — wraps the three backend conversation history endpoints.
 *
 *   GET /api/v1/conversations/sessions          → session list (sidebar)
 *   GET /api/v1/conversations/sessions/{id}     → full transcript
 *   GET /api/v1/conversations/search?q=...      → full-text search
 */

import { apiUrl, authHeaders } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationSession {
  session_id: string;
  message_count: number;
  last_message_at: string;   // ISO timestamp
  preview: string;           // first user message (truncated)
  title?: string | null;     // AI-generated or auto-set one-liner title
  job_id?: string | null;
}

export interface ConversationMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;        // ISO timestamp
  channel: string;
  job_id?: string | null;
  tool_calls?: Record<string, unknown> | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/** Fetch all sessions, most recent first. */
export async function fetchSessions(): Promise<ConversationSession[]> {
  const auth = await authHeaders();
  const res = await fetch(apiUrl("/conversations/sessions"), { headers: auth });
  if (!res.ok) throw new Error(`sessions: ${res.status}`);
  const data = await res.json();
  return data.sessions ?? [];
}

/** Fetch every message in a session, oldest first. */
export async function fetchSessionMessages(
  sessionId: string,
): Promise<ConversationMessage[]> {
  const auth = await authHeaders();
  const res = await fetch(apiUrl(`/conversations/sessions/${sessionId}`), { headers: auth });
  if (!res.ok) throw new Error(`session ${sessionId}: ${res.status}`);
  const data = await res.json();
  return data.messages ?? [];
}

/** Set a display title for a session (called after first turn). */
export async function setSessionTitle(sessionId: string, title: string): Promise<void> {
  const auth = await authHeaders();
  await fetch(apiUrl(`/conversations/sessions/${sessionId}/title`), {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

/** Delete all messages in a session. */
export async function deleteSession(sessionId: string): Promise<void> {
  const auth = await authHeaders();
  await fetch(apiUrl(`/conversations/sessions/${sessionId}`), {
    method: "DELETE",
    headers: auth,
  });
}

/** Full-text search across all conversation messages. */
export async function searchConversations(
  query: string,
): Promise<ConversationMessage[]> {
  if (!query.trim()) return [];
  const auth = await authHeaders();
  const url = apiUrl(`/conversations/search?q=${encodeURIComponent(query)}`);
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`search: ${res.status}`);
  const data = await res.json();
  return data.messages ?? [];
}
