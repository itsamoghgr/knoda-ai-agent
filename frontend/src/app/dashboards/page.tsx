"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquare,
  LayoutDashboard,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDashboards, useCreateDashboard, useDeleteDashboard } from "@/lib/hooks/use-charts";
import type { Dashboard } from "@/types/api";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DashboardsPage() {
  const router = useRouter();
  const { data: dashboards = [], isLoading } = useDashboards();
  const createDashboard = useCreateDashboard();
  const deleteDashboard = useDeleteDashboard();

  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filtered = dashboards.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id));

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((d) => d.id)));
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const d = await createDashboard.mutateAsync({
        name: newName.trim(),
        description: newDesc.trim(),
      });
      toast.success("Dashboard created!");
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      router.push(`/dashboards/${d.id}`);
    } catch {
      toast.error("Failed to create dashboard");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDashboard.mutateAsync(id);
      toast.success("Dashboard deleted");
    } catch {
      toast.error("Failed to delete dashboard");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => deleteDashboard.mutateAsync(id)));
      toast.success(`${ids.length} dashboard${ids.length !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      setSelectionMode(false);
    } catch {
      toast.error("Failed to delete some dashboards");
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Dashboards</h1>
            <p className="text-sm text-muted-foreground">
              {dashboards.length} dashboard{dashboards.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectionMode ? (
              <>
                <div className="flex items-center gap-2 mr-2">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                    id="select-all-dashboards"
                  />
                  <label htmlFor="select-all-dashboards" className="text-sm text-muted-foreground cursor-pointer select-none">
                    {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
                  </label>
                </div>
                {selectedIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete {selectedIds.size}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={toggleSelectionMode}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={toggleSelectionMode} disabled={dashboards.length === 0}>
                  <CheckSquare className="mr-2 h-4 w-4" />
                  Select
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Dashboard
                </Button>
              </>
            )}
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            {/* trigger handled by button above */}
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Dashboard</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="mb-1.5 block">Name</Label>
                  <Input
                    placeholder="e.g. Sales Overview"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Description (optional)</Label>
                  <Textarea
                    placeholder="What is this dashboard for?"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newName.trim() || createDashboard.isPending}
                >
                  {createDashboard.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="mt-3 relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search dashboards…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-4 text-muted-foreground">
            <LayoutDashboard className="h-16 w-16 opacity-20" />
            {search ? (
              <p>No dashboards match &quot;{search}&quot;</p>
            ) : (
              <>
                <p className="text-base">No dashboards yet</p>
                <Button onClick={() => setCreateOpen(true)} variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Create your first dashboard
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((d) => (
              <DashboardCard
                key={d.id}
                dashboard={d}
                onOpen={() => router.push(`/dashboards/${d.id}`)}
                onDelete={() => setDeletingId(d.id)}
                selectionMode={selectionMode}
                selected={selectedIds.has(d.id)}
                onToggle={() => toggleItem(d.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Single delete dialog */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={(o: boolean) => !o && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dashboard?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId && handleDelete(deletingId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !o && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} dashboard{selectedIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              {bulkDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DashboardCard({
  dashboard,
  onOpen,
  onDelete,
  selectionMode,
  selected,
  onToggle,
}: {
  dashboard: Dashboard;
  onOpen: () => void;
  onDelete: () => void;
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary border-primary/50"
      )}
      onClick={selectionMode ? onToggle : onOpen}
    >
      {/* Checkbox in selection mode */}
      {selectionMode && (
        <div className="absolute left-3 top-3 z-10" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} />
        </div>
      )}

      <div className={cn("mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary", selectionMode && "ml-6")}>
        <LayoutDashboard className="h-5 w-5" />
      </div>
      <p className="truncate font-medium">{dashboard.name}</p>
      {dashboard.description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {dashboard.description}
        </p>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground">
        {formatDate(dashboard.created_at)}
      </p>

      {/* Delete button — only in normal mode */}
      {!selectionMode && (
        <button
          className="absolute right-3 top-3 hidden rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
