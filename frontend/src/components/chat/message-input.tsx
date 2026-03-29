"use client";

import { useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MessageInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (msg: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  chips?: string[];
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled = false,
  chips = [],
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onChange("");
    onSend(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [value, streaming, disabled, onChange, onSend]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleChipClick(chip: string) {
    if (streaming || disabled) return;
    onSend(chip);
  }

  return (
    <div className="space-y-2">
      {/* Quick-action chips */}
      {chips.length > 0 && !streaming && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip, i) => (
            <motion.button
              key={chip}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => handleChipClick(chip)}
              className="inline-flex items-center rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              {chip}
            </motion.button>
          ))}
        </div>
      )}

      {/* Input box */}
      <motion.div
        animate={{ boxShadow: streaming ? "0 0 0 1px hsl(var(--primary)/0.3), 0 4px 12px hsl(var(--primary)/0.08)" : "none" }}
        transition={{ duration: 0.2 }}
        className={cn(
          "rounded-xl border bg-background px-4 py-3 flex items-end gap-3 transition-[border-color]",
          streaming ? "border-primary/30" : "border-border/60 focus-within:border-border",
        )}
      >
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your data..."
          className="flex-1 min-h-0 max-h-40 resize-none text-sm border-0 shadow-none focus-visible:ring-0 px-0 py-0 bg-transparent leading-relaxed"
          rows={1}
          disabled={streaming || disabled}
        />

        {streaming ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg mb-0.5"
            onClick={onStop}
            title="Stop generation"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg mb-0.5"
            disabled={!value.trim() || disabled}
            onClick={submit}
            title="Send (Enter)"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </motion.div>

      <p className="text-[11px] text-muted-foreground/40 text-center">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
