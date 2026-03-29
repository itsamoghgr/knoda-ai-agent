"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Loader2,
  Plus,
  X,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  listMeetings,
  scheduleMeeting,
  cancelMeeting,
  deleteMeeting,
  updateMeeting,
  type Meeting,
  type MeetingStatus,
} from "@/lib/api/meetings";
import { listDashboards } from "@/lib/api/charts";

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<MeetingStatus, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  running: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: MeetingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status === "running" && (
        <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500" />
      )}
      {status}
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalDatetimeValue(iso: string) {
  // Convert ISO string to "YYYY-MM-DDTHH:mm" for datetime-local input
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MeetingsPage() {
  const qc = useQueryClient();

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: listMeetings,
    refetchInterval: 15_000,
  });

  const { data: dashboards = [] } = useQuery({
    queryKey: ["dashboards"],
    queryFn: listDashboards,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelMeeting,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Meeting cancelled");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduleMutation = useMutation({
    mutationFn: scheduleMeeting,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Meeting scheduled!");
      setScheduleOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...req }: { id: string } & Parameters<typeof updateMeeting>[1]) =>
      updateMeeting(id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Meeting updated!");
      setEditMeeting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMeeting,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Meeting deleted");
      setDeletingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);

  // Schedule form state
  const [meetUrl, setMeetUrl] = useState("");
  const [dashboardId, setDashboardId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // Edit form state (pre-filled from selected meeting)
  const [editMeetUrl, setEditMeetUrl] = useState("");
  const [editDashboardId, setEditDashboardId] = useState("");
  const [editScheduledAt, setEditScheduledAt] = useState("");

  function resetForm() {
    setMeetUrl("");
    setDashboardId("");
    setScheduledAt("");
  }

  function openEdit(m: Meeting) {
    setEditMeeting(m);
    setEditMeetUrl(m.meet_url);
    setEditDashboardId(m.dashboard_id ?? "");
    setEditScheduledAt(toLocalDatetimeValue(m.scheduled_at));
  }

  function handleSchedule() {
    if (!meetUrl || !dashboardId || !scheduledAt) return;
    scheduleMutation.mutate({
      meet_url: meetUrl,
      dashboard_id: dashboardId,
      scheduled_at: new Date(scheduledAt).toISOString(),
    });
  }

  function handleUpdate() {
    if (!editMeeting || !editMeetUrl || !editDashboardId || !editScheduledAt) return;
    updateMutation.mutate({
      id: editMeeting.id,
      meet_url: editMeetUrl,
      dashboard_id: editDashboardId,
      scheduled_at: new Date(editScheduledAt).toISOString(),
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Meeting Presentations</h1>
            <p className="text-sm text-muted-foreground">
              Schedule the AI bot to join Google Meet and present dashboards
            </p>
          </div>
          <Button onClick={() => setScheduleOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Schedule Meeting
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : meetings.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-4 text-muted-foreground">
            <CalendarClock className="h-16 w-16 opacity-20" />
            <p className="text-base">No meetings scheduled yet</p>
            <p className="max-w-sm text-center text-sm">
              You can also schedule a meeting from the chat by saying
              &quot;Join meet.google.com/xxx at 4:30 PM and present the Sales Dashboard&quot;
            </p>
            <Button onClick={() => setScheduleOpen(true)} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Schedule your first meeting
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Dashboard</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Meet URL</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scheduled At</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {meetings.map((m) => (
                  <MeetingRow
                    key={m.id}
                    meeting={m}
                    dashboardName={
                      dashboards.find((d) => d.id === m.dashboard_id)?.name ?? m.dashboard_id ?? "—"
                    }
                    onEdit={() => openEdit(m)}
                    onCancel={() => setCancellingId(m.id)}
                    onDelete={() => setDeletingId(m.id)}
                    cancelling={cancelMutation.isPending && cancellingId === m.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={(o) => { setScheduleOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Meeting Presentation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Google Meet URL</Label>
              <Input
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                value={meetUrl}
                onChange={(e) => setMeetUrl(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Dashboard</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={dashboardId}
                onChange={(e) => setDashboardId(e.target.value)}
              >
                <option value="">Select a dashboard…</option>
                {dashboards.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block">Date & Time</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setScheduleOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSchedule}
              disabled={!meetUrl || !dashboardId || !scheduledAt || scheduleMutation.isPending}
            >
              {scheduleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editMeeting} onOpenChange={(o) => !o && setEditMeeting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Meeting</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Google Meet URL</Label>
              <Input
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                value={editMeetUrl}
                onChange={(e) => setEditMeetUrl(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Dashboard</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={editDashboardId}
                onChange={(e) => setEditDashboardId(e.target.value)}
              >
                <option value="">Select a dashboard…</option>
                {dashboards.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block">Date & Time</Label>
              <Input
                type="datetime-local"
                value={editScheduledAt}
                onChange={(e) => setEditScheduledAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMeeting(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={!editMeetUrl || !editDashboardId || !editScheduledAt || updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              {meetings.find((m) => m.id === deletingId)?.status === "running"
                ? "This meeting appears to be running but may be stale. Deleting it will permanently remove the record."
                : "This will permanently remove the meeting record. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirmation */}
      <AlertDialog open={!!cancellingId} onOpenChange={(o) => !o && setCancellingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              The bot will not join this meeting. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancellingId && cancelMutation.mutate(cancellingId)}
            >
              Cancel meeting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MeetingRow({
  meeting,
  dashboardName,
  onEdit,
  onCancel,
  onDelete,
  cancelling,
}: {
  meeting: Meeting;
  dashboardName: string;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  cancelling: boolean;
}) {
  const canDelete = ["completed", "failed", "cancelled", "running"].includes(meeting.status);

  return (
    <tr className="bg-card hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 font-medium">{dashboardName}</td>
      <td className="px-4 py-3">
        <a
          href={meeting.meet_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {meeting.meet_url.replace("https://meet.google.com/", "")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatDateTime(meeting.scheduled_at)}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={meeting.status} />
        {meeting.error_message && (
          <p className="mt-0.5 text-xs text-destructive">{meeting.error_message}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {meeting.status === "scheduled" && (
            <>
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              <button
                onClick={onCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                Cancel
              </button>
            </>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
