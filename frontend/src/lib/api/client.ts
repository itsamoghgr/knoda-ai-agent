import { createClient } from "@/lib/supabase/client";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Return the Supabase access token for the current session, or null. */
async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Build auth headers — injects Bearer token when a Supabase session exists. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const auth = await authHeaders();
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...auth,
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new ApiError(response.status, message);
  }

  // 204 No Content
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}
