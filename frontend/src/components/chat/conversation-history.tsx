"use client";

import { useCallback, useState } from "react";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useConversationSessions,
  useConversationSearch,
} from "@/lib/hooks/use-conversations";
import type { ConversationSession } from "@/lib/api/conversations";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupSessions(sessions: ConversationSession[]) {
  const today: ConversationSession[] = [];
  const yesterday: ConversationSession[] = [];
  const earlier: ConversationSession[] = [];
  for (const s of sessions) {
    const d = new Date(s.last_message_at);
    if (isToday(d)) today.push(s);
    else if (isYesterday(d)) yesterday.push(s);
    else earlier.push(s);
  }
  return { today, yesterday, earlier };
}

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
  catch { return ""; }
}

// ─── SessionItem ──────────────────────────────────────────────────────────────

function SessionItem({
  session,
  active,
  onClick,
}: {
  session: ConversationSession;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg px-3 py-2.5 text-xs transition-colors group",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <p className="font-medium truncate leading-snug text-foreground/90 group-hover:text-foreground">
        {session.preview || "New conversation"}
      </p>
      <p className={cn("mt-0.5 flex items-center gap-1", active ? "text-primary/70" : "text-muted-foreground/60")}>
        <Clock className="h-2.5 w-2.5 shrink-0" />
        {timeAgo(session.last_message_at)}
        <span className="mx-1 opacity-40">·</span>
        {session.message_count} msg{session.message_count !== 1 ? "s" : ""}
      </p>
    </button>
  );
}

function SessionGroup({
  label,
  sessions,
  activeId,
  onSelect,
}: {
  label: string;
  sessions: ConversationSession[];
  activeId: string | null;
  onSelect: (s: ConversationSession) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <div>
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
        {label}
      </p>
      <div className="space-y-0.5">
        {sessions.map((s) => (
          <SessionItem
            key={s.session_id}
            session={s}
            active={s.session_id === activeId}
            onClick={() => onSelect(s)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ConversationHistory ──────────────────────────────────────────────────────

interface ConversationHistoryProps {
  /** Currently live session ID — highlighted in the list */
  activeSessionId: string;
  /** Currently selected (viewing) session ID — also highlighted */
  selectedSessionId: string | null;
  /** Called when user clicks a session — parent renders transcript on the right */
  onSelectSession: (sessionId: string) => void;
  /** Called when user clicks New Chat */
  onNewChat: () => void;
}

export function ConversationHistory({
  activeSessionId,
  selectedSessionId,
  onSelectSession,
  onNewChat,
}: ConversationHistoryProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const { sessions, loading } = useConversationSessions();
  const { query, results, searching, search, clear: clearSearch } = useConversationSearch();

  const groups = groupSessions(sessions);

  const handleSelect = useCallback((s: ConversationSession) => {
    onSelectSession(s.session_id);
    setShowSearch(false);
    clearSearch();
  }, [onSelectSession, clearSearch]);

  // ── Collapsed ───────────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-r bg-background px-2 py-3 w-12 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCollapsed(false)} title="Expand history">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNewChat} title="New chat">
          <Plus className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        <MessageSquare className="h-4 w-4 text-muted-foreground/40" />
      </div>
    );
  }

  // ── Expanded ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col border-r bg-background w-56 shrink-0 h-full">

      {/* Header */}
      <div className="flex items-center gap-1.5 border-b px-3 py-3 shrink-0">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <p className="text-xs font-semibold flex-1 text-muted-foreground">History</p>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
          onClick={() => { setShowSearch((s) => !s); clearSearch(); }} title="Search">
          {showSearch ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onNewChat} title="New chat">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setCollapsed(true)} title="Collapse">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search input */}
      {showSearch && (
        <div className="px-3 py-2 border-b shrink-0">
          <Input
            placeholder="Search conversations…"
            className="h-7 text-xs"
            value={query}
            onChange={(e) => search(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="px-1 py-2 space-y-3">
          {showSearch && query ? (
            <div className="space-y-0.5">
              {searching ? (
                <p className="text-[11px] text-muted-foreground text-center py-4">Searching…</p>
              ) : results.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-4">No results</p>
              ) : (
                results.map((msg) => (
                  <button
                    key={msg.id}
                    onClick={() => onSelectSession(msg.session_id)}
                    className="w-full text-left rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <p className="font-medium text-foreground/80 truncate">{msg.content.slice(0, 60)}</p>
                    <p className="text-[10px] opacity-50 mt-0.5">{timeAgo(msg.created_at)}</p>
                  </button>
                ))
              )}
            </div>
          ) : loading ? (
            <p className="text-[11px] text-muted-foreground text-center py-8">Loading…</p>
          ) : sessions.length === 0 ? (
            <div className="text-center py-10 space-y-2 px-3">
              <MessageSquare className="h-6 w-6 text-muted-foreground/30 mx-auto" />
              <p className="text-[11px] text-muted-foreground/60">
                No conversations yet.<br />Start chatting to see history here.
              </p>
            </div>
          ) : (
            <>
              <SessionGroup label="Today"     sessions={groups.today}     activeId={selectedSessionId ?? activeSessionId} onSelect={handleSelect} />
              <SessionGroup label="Yesterday" sessions={groups.yesterday} activeId={selectedSessionId ?? activeSessionId} onSelect={handleSelect} />
              <SessionGroup label="Earlier"   sessions={groups.earlier}   activeId={selectedSessionId ?? activeSessionId} onSelect={handleSelect} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
