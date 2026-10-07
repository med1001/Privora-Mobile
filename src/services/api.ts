import { config } from "../config/env";

type SearchUserResponse = {
  userId: string;
  displayName: string;
};

export type RtcConfigResponse = {
  iceServers?: Array<{ urls?: string | string[]; username?: string; credential?: string; url?: string }>;
  iceTransportPolicy?: "all" | "relay";
};

export type UploadResponse = {
  url: string;
  filename?: string;
  type?: string;
};

export type SettingsProfile = {
  userId: string;
  displayName: string;
  photoURL?: string | null;
};

type SettingsPhotoResponse = {
  message: string;
  user: SettingsProfile;
};

type SupportRequestResponse = {
  message: string;
  requestId: number;
};

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const url = `${config.apiBaseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg} (${url}). Check network / TLS and that the API base URL matches your build (see docs/backend-environment.md). For a local backend, set EXPO_PUBLIC_API_* in .env.local and rebuild.`,
    );
  }

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

export function registerPushToken(token: string, deviceToken: string, platform: "android" | "ios" | "web", signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>("/api/push/register", token, {
    method: "POST",
    body: JSON.stringify({ token: deviceToken, platform }),
    signal,
  });
}

export function unregisterPushToken(token: string, deviceToken: string, signal?: AbortSignal) {
  return apiFetch<{ ok: boolean }>("/api/push/unregister", token, {
    method: "POST",
    body: JSON.stringify({ token: deviceToken }),
    signal,
  });
}

export function fetchSettingsProfile(token: string) {
  return apiFetch<SettingsProfile>("/api/settings/me", token, {
    method: "GET",
  });
}

export async function uploadProfilePhoto(asset: UploadAsset, token: string): Promise<SettingsPhotoResponse> {
  const formData = new FormData();
  formData.append("file", {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType,
  } as unknown as Blob);

  const response = await fetch(`${config.apiBaseUrl}/api/settings/profile-photo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const data = (await response.json().catch(() => ({}))) as Partial<SettingsPhotoResponse> & {
    detail?: string;
  };
  if (!response.ok || !data.user) {
    throw new Error(data.detail || "Could not update profile photo.");
  }
  return data as SettingsPhotoResponse;
}

function submitSupportRequest(
  endpoint: "/api/settings/contact" | "/api/settings/report-issue",
  subject: string,
  message: string,
  token: string,
) {
  return apiFetch<SupportRequestResponse>(endpoint, token, {
    method: "POST",
    body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
  });
}

export function contactSupport(subject: string, message: string, token: string) {
  return submitSupportRequest("/api/settings/contact", subject, message, token);
}

export function reportIssue(subject: string, message: string, token: string) {
  return submitSupportRequest("/api/settings/report-issue", subject, message, token);
}

export function deletePrivoraAccount(token: string) {
  return apiFetch<{ message: string }>("/api/settings/account", token, {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadAsset = {
  uri: string;
  name: string;
  mimeType: string;
};

export async function uploadAttachment(asset: UploadAsset, token: string): Promise<UploadResponse> {
  const formData = new FormData();
  // React Native FormData expects this pseudo-File shape.
  formData.append("file", {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType,
  } as unknown as Blob);

  const url = `${config.apiBaseUrl}/api/upload`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg} (${url}). Check backend and EXPO_PUBLIC_API_HOST / adb reverse, then rebuild.`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Upload failed (${response.status}): ${body || response.statusText}`);
  }

  return (await response.json()) as UploadResponse;
}

export function buildAssetUrl(relativeOrAbsolute: string): string {
  if (!relativeOrAbsolute) return "";
  if (/^(https?:|data:|file:)/i.test(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  const base = config.apiBaseUrl.replace(/\/+$/g, "");
  const path = relativeOrAbsolute.startsWith("/") ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
  return `${base}${path}`;
}
