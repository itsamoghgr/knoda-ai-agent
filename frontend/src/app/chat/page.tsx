"use client";

/**
 * /chat — full-width chat panel. Session history lives in the main Sidebar.
 * Loading a past session: navigate to /chat?session=<id>
 * New chat: navigate to /chat (no param)
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatPanel } from "@/components/layout/chat-panel";
import { fetchSessionMessages } from "@/lib/api/conversations";
import type { ChatMessage } from "@/types/api";
import type { ConversationMessage } from "@/lib/api/conversations";

const ROUTE_TAG_RE = /<route>\s*(?:analyst|discovery)\s*<\/route>/g;

function cleanContent(text: string): string {
  return text.replace(ROUTE_TAG_RE, "").trim();
}

function toUiMessages(msgs: ConversationMessage[]): ChatMessage[] {
  return msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.role === "assistant" ? cleanContent(m.content) : m.content,
      timestamp: new Date(m.created_at),
    }));
}

interface ActiveSession {
  sessionId: string;
  initialMessages: ChatMessage[];
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionParam = searchParams.get("session");

  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [chatKey, setChatKey] = useState(0);

  // Load session from URL param on mount / param change
  useEffect(() => {
    if (!sessionParam) {
      setActiveSession(null);
      setChatKey((k) => k + 1);
      return;
    }
    fetchSessionMessages(sessionParam)
      .then((msgs) => {
        setActiveSession({ sessionId: sessionParam, initialMessages: toUiMessages(msgs) });
        setChatKey((k) => k + 1);
      })
      .catch(() => {
        setActiveSession({ sessionId: sessionParam, initialMessages: [] });
        setChatKey((k) => k + 1);
      });
  }, [sessionParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewChat = useCallback(() => {
    router.push("/chat");
  }, [router]);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <ChatPanel
        key={chatKey}
        jobId={null}
        showClose={false}
        initialMessages={activeSession?.initialMessages}
        initialSessionId={activeSession?.sessionId}
        onNewChat={handleNewChat}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
