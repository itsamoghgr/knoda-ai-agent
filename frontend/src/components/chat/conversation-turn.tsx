"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ActivityStream } from "./activity-stream";
import { DataArtifact } from "./data-artifact";
import type { ChatMessage } from "@/types/api";

// ─── Markdown renderer ────────────────────────────────────────────────────────

function Narrative({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed text-sm">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1 text-sm">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ children }) => (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono border border-border/50">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="rounded-lg bg-muted/80 border border-border/50 p-3 text-xs font-mono overflow-x-auto mb-3 whitespace-pre">{children}</pre>
        ),
        h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1.5 mt-3 first:mt-0">{children}</h3>,
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-border/60">
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y divide-border/40">{children}</tbody>,
        tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{children}</th>
        ),
        td: ({ children }) => <td className="px-3 py-2 text-sm">{children}</td>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80 break-words"
          >
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ text }: { text: string }) {
  const isWaiting = /waiting|rate limit|retrying/i.test(text);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className={
        isWaiting
          ? "inline-flex items-center gap-2 rounded-full bg-amber-500/5 border border-amber-500/20 px-3 py-1.5 text-xs text-amber-600/90 dark:text-amber-400/90"
          : "inline-flex items-center gap-2 rounded-full bg-primary/5 border border-primary/15 px-3 py-1.5 text-xs text-primary/80"
      }
    >
      <span className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isWaiting ? "bg-amber-400/40" : "bg-primary/40"}`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${isWaiting ? "bg-amber-500/60" : "bg-primary/60"}`} />
      </span>
      {text}
    </motion.div>
  );
}

// ─── Follow-up chips ──────────────────────────────────────────────────────────

function getFollowUpChips(tools: ChatMessage[]): string[] {
  const hasSql = tools.some(t => t.toolName === "execute_sql" || t.toolName === "run_sql");
  const hasRelationships = tools.some(t => t.toolName === "get_relationships");
  const hasSchema = tools.some(t => t.toolName === "explore_schema" || t.toolName === "describe_table");

  if (hasSql) {
    return [
      "Break this down by region",
      "Show the trend over time",
      "Add this to a dashboard",
    ];
  }
  if (hasRelationships) {
    return [
      "Show me the largest fact tables",
      "What revenue metrics are available?",
    ];
  }
  if (hasSchema) {
    return [
      "Which are the fact tables?",
      "What revenue metrics are available?",
      "Show me relationships between tables",
    ];
  }
  return [
    "Can you show this as a chart?",
    "Tell me more",
  ];
}

// ─── ConversationTurn ─────────────────────────────────────────────────────────

export interface Turn {
  userMessage: ChatMessage;
  agentMessages: ChatMessage[];   // role: tool | thinking | assistant
  isFirst: boolean;
  isStreaming: boolean;
  streamingMsgId: string | null;
}

export function ConversationTurn({ turn, onSend }: { turn: Turn; onSend: (msg: string) => void }) {
  const { userMessage, agentMessages, isFirst, isStreaming, streamingMsgId } = turn;

  // Separate tools, status, and narrative (assistant + thinking)
  const toolMessages = agentMessages.filter(m => m.role === "tool");
  const statusMessages = agentMessages.filter(m => m.role === "status");
  const narrativeMessages = agentMessages.filter(m => m.role === "assistant" || m.role === "thinking");

  // Determine primary data artifact: last execute_sql tool with rows
  const sqlTools = toolMessages.filter(
    t => (t.toolName === "execute_sql" || t.toolName === "run_sql") && !t.isLoading
  );
  const primarySqlTool = sqlTools[sqlTools.length - 1] ?? null;

  const artifactRows    = primarySqlTool?.toolResult?.rows ?? [];
  const artifactColumns = artifactRows.length > 0 ? Object.keys(artifactRows[0]) : [];
  const artifactTrunc   = primarySqlTool?.toolResult?.truncated ?? false;

  // Streaming: show skeleton if tools are running but no SQL result yet
  const toolsRunning   = toolMessages.some(t => t.isLoading);
  const showSkeletonArtifact = toolsRunning && artifactRows.length === 0;

  // Narrative text content
  const narrativeText = narrativeMessages.map(m => m.content).join("\n\n").trim();
  const lastMsgId = agentMessages[agentMessages.length - 1]?.id;
  const isLastStreaming = lastMsgId === streamingMsgId;

  // Follow-up chips — only shown after streaming is fully done
  const followUpChips = !isStreaming && agentMessages.length > 0
    ? getFollowUpChips(toolMessages)
    : [];

  const [chipsVisible] = useState(true);

  return (
    <div className="space-y-5">
      {/* Separator between turns */}
      {!isFirst && <Separator className="my-2 opacity-40" />}

      {/* User question */}
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-red-500 px-4 py-2.5 text-sm text-white leading-relaxed">
          {userMessage.content}
        </div>
      </div>

      {/* Agent response block */}
      {agentMessages.length > 0 && (
        <div className="space-y-4">

          {/* Activity stream */}
          {toolMessages.length > 0 && (
            <ActivityStream tools={toolMessages} isStreaming={isStreaming && toolsRunning} />
          )}

          {/* Status indicator — shows during agentic processing */}
          <AnimatePresence>
            {isStreaming && statusMessages.length > 0 && (
              <StatusPill text={statusMessages[statusMessages.length - 1].statusText ?? "Working..."} />
            )}
          </AnimatePresence>

          {/* Data artifact — show skeleton if tools running, real data once arrived */}
          {(showSkeletonArtifact || artifactRows.length > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <DataArtifact
                rows={artifactRows}
                columns={artifactColumns}
                truncated={artifactTrunc}
                isStreaming={showSkeletonArtifact}
              />
            </motion.div>
          )}

          {/* Agent narrative — below the data */}
          {(narrativeText || isLastStreaming) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="text-foreground/90 leading-relaxed"
            >
              {narrativeText ? (
                <Narrative content={narrativeText} />
              ) : isLastStreaming ? (
                <span className="inline-flex items-end gap-[3px] h-4">
                  <span className="w-[3px] rounded-full bg-primary/60 animate-[aiwave_1.2s_ease-in-out_infinite] [animation-delay:0ms]"   style={{ height: "55%" }} />
                  <span className="w-[3px] rounded-full bg-primary/80 animate-[aiwave_1.2s_ease-in-out_infinite] [animation-delay:150ms]" style={{ height: "100%" }} />
                  <span className="w-[3px] rounded-full bg-primary    animate-[aiwave_1.2s_ease-in-out_infinite] [animation-delay:300ms]" style={{ height: "75%" }} />
                  <span className="w-[3px] rounded-full bg-primary/80 animate-[aiwave_1.2s_ease-in-out_infinite] [animation-delay:450ms]" style={{ height: "100%" }} />
                  <span className="w-[3px] rounded-full bg-primary/60 animate-[aiwave_1.2s_ease-in-out_infinite] [animation-delay:600ms]" style={{ height: "55%" }} />
                </span>
              ) : null}
            </motion.div>
          )}

          {/* Follow-up chips */}
          <AnimatePresence>
            {chipsVisible && followUpChips.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex flex-wrap gap-2 pt-1"
              >
                {followUpChips.map((chip, i) => (
                  <motion.div
                    key={chip}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 + i * 0.08 }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full h-7 text-xs font-normal text-muted-foreground hover:text-foreground border-border/60"
                      onClick={() => onSend(chip)}
                    >
                      {chip}
                    </Button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
