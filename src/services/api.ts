import { config } from "../config/env";

type SearchUserResponse = {
  userId: string;
  displayName: string;
};

export type RtcConfigResponse = {
  iceServers?: Array<{ urls?: string | string[]; username?: string; credential?: string; url?: string }>;
  iceTransportPolicy?: "all" | "relay";
};

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body || response.statusText}`);
  }

  return (await response.json()) as T;
}

export function searchUsers(query: string, token: string) {
  const encoded = encodeURIComponent(query.trim());
  return apiFetch<SearchUserResponse[]>(`/search-users?q=${encoded}`, token, {
    method: "GET",
  });
}

export function fetchRtcConfig(token: string) {
  return apiFetch<RtcConfigResponse>("/api/rtc-config", token, {
    method: "GET",
  });
}
