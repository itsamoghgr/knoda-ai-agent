"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { ChatPanel } from "./chat-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function GlobalChatButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating action button */}
      <Tooltip>
        <TooltipTrigger>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Open AI Assistant"
            className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
          >
            <Bot className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">AI Assistant (all databases)</TooltipContent>
      </Tooltip>

      {/* Slide-over panel */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div className="relative ml-auto w-[420px] max-w-[95vw] shadow-2xl border-l bg-background">
            <ChatPanel onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
