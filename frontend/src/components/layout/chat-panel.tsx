"use client";

import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceChat } from "@/components/chat/workspace-chat";
import type { ChatMessage } from "@/types/api";

interface ChatPanelProps {
  jobId?: string | null;
  title?: string;
  onClose?: () => void;
  showClose?: boolean;
  onNewChat?: () => void;
  onSessionId?: (sid: string) => void;
  /** Pre-loaded messages when resuming a past session */
  initialMessages?: ChatMessage[];
  /** Session ID to resume */
  initialSessionId?: string;
}

export function ChatPanel({
  jobId,
  title,
  onClose,
  showClose = true,
  onNewChat,
  onSessionId,
  initialMessages,
  initialSessionId,
}: ChatPanelProps) {
  const panelTitle = title ?? (jobId ? "Ask about this database" : "New Chat");
  const subtitle = jobId
    ? "Ask anything about this database's schema and metrics."
    : "Ask questions across all your connected databases.";

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4 shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold truncate">{panelTitle}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
        {showClose && onClose && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Workspace */}
      <WorkspaceChat
        jobId={jobId}
        initialMessages={initialMessages}
        initialSessionId={initialSessionId}
        onNewChat={onNewChat}
        onSessionId={onSessionId}
      />
    </div>
  );
}
