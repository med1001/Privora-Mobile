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
      `${msg} (${url}). Is the backend running on :8000? On a real phone set EXPO_PUBLIC_API_HOST in .env.local to your PC IP (or 127.0.0.1 + adb reverse), then rebuild.`,
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
