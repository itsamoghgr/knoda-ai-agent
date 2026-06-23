"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart2,
  Database,
  LayoutDashboard,
  LogOut,
  MessageSquarePlus,
  Moon,
  MoreHorizontal,
  PieChart,
  Settings,
  Sun,
  Terminal,
  Trash2,
  Video,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Suspense, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/hooks/use-settings";
import { isLlmConfigured } from "@/lib/llm-settings";
import { createClient } from "@/lib/supabase/client";
import { useConversationSessions } from "@/lib/hooks/use-conversations";
import { formatDistanceToNow } from "date-fns";

// ─── Nav structure ────────────────────────────────────────────────────────────

const mainNav = [
  { href: "/overview",    icon: LayoutDashboard,  label: "Overview",    match: (p: string) => p === "/overview" },
  { href: "/databases",   icon: Database,          label: "Databases",   match: (p: string) => p === "/databases" || p.startsWith("/jobs") },
  { href: "/sql-lab",     icon: Terminal,          label: "SQL Lab",     match: (p: string) => p === "/sql-lab" },
  { href: "/charts",      icon: BarChart2,         label: "Charts",      match: (p: string) => p === "/charts" || p.startsWith("/charts/") },
  { href: "/dashboards",  icon: PieChart,          label: "Dashboards",  match: (p: string) => p === "/dashboards" || p.startsWith("/dashboards/") },
  { href: "/meetings",    icon: Video,             label: "Meetings",    match: (p: string) => p === "/meetings" || p.startsWith("/meetings/") },
];

// ─── Chat session item ────────────────────────────────────────────────────────

function ChatSessionItem({
  sessionId,
  title,
  preview,
  lastMessageAt,
  active,
  onDelete,
}: {
  sessionId: string;
  title?: string | null;
  preview: string;
  lastMessageAt: string;
  active: boolean;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = title || preview || "New conversation";

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuOpen(true);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    onDelete();
  }

  // Close menu on outside click
  function handleBlur() {
    setTimeout(() => setMenuOpen(false), 120);
  }

  return (
    <div className="relative group">
      <button
        onClick={() => router.push(`/chat?session=${sessionId}`)}
        onContextMenu={handleContextMenu}
        className={cn(
          "w-full text-left rounded-lg px-2.5 py-1.5 text-xs transition-colors pr-7",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <p className="font-medium truncate leading-snug text-foreground/85">{label}</p>
        <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">
          {formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true })}
        </p>
      </button>

      {/* Hover action button */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onFocus={() => {}}
          onBlur={handleBlur}
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </div>

      {/* Dropdown */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-7 z-50 w-32 rounded-md border bg-popover shadow-md py-1"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            onClick={handleDelete}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function SidebarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: settings } = useSettings();
  const llmConfigured = isLlmConfigured(settings);
  const { theme, setTheme } = useTheme();
  const { sessions, deleteSession } = useConversationSessions();

  const activeSessionId = searchParams.get("session") ?? "";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r bg-background z-30">

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b">
        <Image src="/knoda.svg" alt="Knoda AI" width={28} height={28} className="shrink-0" />
        <div>
          <p className="text-sm font-semibold leading-none">Knoda AI</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">Agent</p>
        </div>
      </div>

      {/* Main nav + chat history */}
      <nav className="flex flex-col flex-1 min-h-0 overflow-hidden px-3 py-3">
        {/* Top nav items */}
        <div className="space-y-0.5 shrink-0">
          {mainNav.map(({ href, icon: Icon, label, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Divider + New Chat button */}
        <div className="mt-3 mb-1 shrink-0">
          <div className="border-t mb-2" />
          <Link
            href="/chat"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/chat" && !activeSessionId
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <MessageSquarePlus className={cn("h-4 w-4 shrink-0", pathname === "/chat" && !activeSessionId && "text-primary")} />
            New Chat
          </Link>
        </div>

        {/* Chat history — scrollable */}
        {sessions.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-0.5 [scrollbar-width:thin]">
            {sessions.map((s) => (
              <ChatSessionItem
                key={s.session_id}
                sessionId={s.session_id}
                title={s.title}
                preview={s.preview}
                lastMessageAt={s.last_message_at}
                active={s.session_id === activeSessionId}
                onDelete={() => deleteSession(s.session_id)}
              />
            ))}
          </div>
        )}
      </nav>

      {/* Bottom utilities */}
      <div className="border-t px-3 py-3 space-y-1 shrink-0">

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <span className="relative h-4 w-4 shrink-0">
            <Sun className="absolute inset-0 h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute inset-0 h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
          </span>
          <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>

        {/* Settings */}
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/settings"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <span className="relative h-4 w-4 shrink-0">
            <Settings className="h-4 w-4" />
            {!llmConfigured && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
              </span>
            )}
          </span>
          <span className="flex-1">Settings</span>
          {!llmConfigured && (
            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-400">
              Setup
            </span>
          )}
        </Link>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

export function Sidebar() {
  return (
    <Suspense fallback={<div className="w-52 shrink-0 border-r bg-background" />}>
      <SidebarInner />
    </Suspense>
  );
}
