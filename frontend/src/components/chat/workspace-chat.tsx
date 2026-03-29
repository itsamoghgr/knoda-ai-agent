"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import { EmptyState } from "./empty-state";
import { ConversationTurn, type Turn } from "./conversation-turn";
import { MessageInput } from "./message-input";
import type { ChatMessage } from "@/types/api";
import { setSessionTitle } from "@/lib/api/conversations";

// ─── Group flat messages into turns ──────────────────────────────────────────

function groupIntoTurns(
  messages: ChatMessage[],
  streamingMsgId: string | null,
  isStreaming: boolean,
): Turn[] {
  const turns: Turn[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role !== "user") { i++; continue; }
    const agentMsgs: ChatMessage[] = [];
    let j = i + 1;
    while (j < messages.length && messages[j].role !== "user") {
      agentMsgs.push(messages[j]);
      j++;
    }
    const isLastTurn = j >= messages.length;
    turns.push({
      userMessage: msg,
      agentMessages: agentMsgs,
      isFirst: turns.length === 0,
      isStreaming: isLastTurn && isStreaming,
      streamingMsgId: isLastTurn ? streamingMsgId : null,
    });
    i = j;
  }
  return turns;
}

// ─── WorkspaceChat ────────────────────────────────────────────────────────────

export interface WorkspaceChatProps {
  jobId?: string | null;
  /** Pre-loaded messages (for resuming a past session) */
  initialMessages?: ChatMessage[];
  /** Session ID to resume (uses this UUID instead of generating a new one) */
  initialSessionId?: string;
  /** Called on mount and after session rotation — reports current session ID to parent */
  onSessionId?: (sessionId: string) => void;
  /** Called after "New Chat" clears so parent can refresh the history rail */
  onNewChat?: () => void;
}

export function WorkspaceChat({
  jobId,
  initialMessages,
  initialSessionId,
  onSessionId,
  onNewChat,
}: WorkspaceChatProps) {
  const { messages, streaming, streamingMsgId, send, stop, clear, sessionId } =
    useChatStream(jobId, { initialMessages, initialSessionId });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const turns = groupIntoTurns(messages, streamingMsgId, streaming);
  const titleSetRef = useRef(false);

  // Auto-set title from the first user message after the first assistant response completes
  useEffect(() => {
    if (titleSetRef.current) return;
    if (streaming) return;
    if (turns.length !== 1) return; // only on first turn
    if (turns[0].agentMessages.length === 0) return; // wait for assistant response
    const firstUserMsg = turns[0].userMessage.content;
    if (!firstUserMsg) return;
    titleSetRef.current = true;
    // Trim to ~60 chars at a word boundary, capitalize first letter
    const raw = firstUserMsg.trim().replace(/\s+/g, " ");
    const truncated = raw.length > 60 ? raw.slice(0, 60).replace(/\s\S*$/, "") + "…" : raw;
    const title = truncated.charAt(0).toUpperCase() + truncated.slice(1);
    setSessionTitle(sessionId, title).catch(() => {/* best-effort */});
  }, [streaming, turns, sessionId]);

  // Report session ID to parent so history rail can highlight active session
  useEffect(() => {
    onSessionId?.(sessionId);
  }, [sessionId, onSessionId]);

  // Scroll to bottom when messages change (auto-scroll during streaming)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Scroll to bottom on mount when resuming a past session
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }, 50);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewChat = useCallback(() => {
    clear();
    onNewChat?.();
  }, [clear, onNewChat]);

  const handleSend = useCallback((msg: string) => {
    setInput("");
    send(msg);
  }, [send]);

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-background">
      {/* Message area — plain div, no third-party scroll component */}
      <div ref={scrollRef} className="flex-1 min-h-0 w-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {turns.length === 0 ? (
            <EmptyState jobId={jobId} onSend={handleSend} />
          ) : (
            <div className="space-y-8">
              {turns.map((turn) => (
                <ConversationTurn
                  key={turn.userMessage.id}
                  turn={turn}
                  onSend={handleSend}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t bg-background/95 backdrop-blur-sm px-6 py-4 shrink-0">
        <div className="max-w-4xl mx-auto">
          <MessageInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onStop={stop}
            streaming={streaming}
          />
        </div>
      </div>
    </div>
  );
}
