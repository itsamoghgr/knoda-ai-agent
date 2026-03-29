import { apiClient } from "./client";

export type MeetingStatus =
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Meeting {
  id: string;
  dashboard_id: string | null;
  meet_url: string;
  scheduled_at: string;
  status: MeetingStatus;
  recall_bot_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface ScheduleMeetingRequest {
  meet_url: string;
  dashboard_id: string;
  scheduled_at: string; // ISO 8601 with timezone
}

export async function scheduleMeeting(req: ScheduleMeetingRequest): Promise<Meeting> {
  return apiClient<Meeting>("/meetings", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function listMeetings(): Promise<Meeting[]> {
  return apiClient<Meeting[]>("/meetings");
}

export async function getMeeting(id: string): Promise<Meeting> {
  return apiClient<Meeting>(`/meetings/${id}`);
}

export async function cancelMeeting(id: string): Promise<{ cancelled: string }> {
  return apiClient<{ cancelled: string }>(`/meetings/${id}`, {
    method: "DELETE",
  });
}

export interface UpdateMeetingRequest {
  meet_url?: string;
  dashboard_id?: string;
  scheduled_at?: string; // ISO 8601 with timezone
}

export async function updateMeeting(id: string, req: UpdateMeetingRequest): Promise<Meeting> {
  return apiClient<Meeting>(`/meetings/${id}`, {
    method: "PUT",
    body: JSON.stringify(req),
  });
}

export async function deleteMeeting(id: string): Promise<{ deleted: string }> {
  return apiClient<{ deleted: string }>(`/meetings/${id}/delete`, {
    method: "DELETE",
  });
}
