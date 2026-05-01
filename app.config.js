/**
 * API + WebSocket URLs baked into the native build via `expo.extra`.
 *
 * Default: production at https://privora-app.com (TLS).
 * Override for local dev via `.env.local` — see docs/backend-environment.md.
 *
 * Any change to EXPO_PUBLIC_* env vars requires a native rebuild:
 *   npx expo run:android   (or run:ios)
 * Metro reload alone is not enough.
 */
const fs = require("fs");
const path = require("path");

/**
 * @returns {{ apiBaseUrl: string; wsUrl: string }}
 */
function buildApiUrls() {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicit) {
    const base = explicit.replace(/\/$/, "");
    const wsUrl = base.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws";
    return { apiBaseUrl: base, wsUrl };
  }

  const host = (process.env.EXPO_PUBLIC_API_HOST ?? "privora-app.com").trim();
  const portRaw = process.env.EXPO_PUBLIC_API_PORT?.trim();
  const tlsRaw = process.env.EXPO_PUBLIC_API_USE_TLS?.trim().toLowerCase();

  const looksLikeLocalDev =
    host === "10.0.2.2" ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

  const hasExplicitTls =
    tlsRaw === "true" || tlsRaw === "1" || tlsRaw === "false" || tlsRaw === "0";
  const useTls = hasExplicitTls
    ? tlsRaw === "true" || tlsRaw === "1"
    : !looksLikeLocalDev && !portRaw;

  if (useTls) {
    if (portRaw) {
      return {
        apiBaseUrl: `https://${host}:${portRaw}`,
        wsUrl: `wss://${host}:${portRaw}/ws`,
      };
    }
    return {
      apiBaseUrl: `https://${host}`,
      wsUrl: `wss://${host}/ws`,
    };
  }

  const port = portRaw || "8000";
  return {
    apiBaseUrl: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}/ws`,
  };
}

module.exports = ({ config }) => {
  const { apiBaseUrl, wsUrl } = buildApiUrls();

  // Only declare googleServicesFile when the JSON is actually present, so
  // the build does not fail before the developer downloads it. See
  // docs/push-notifications-setup.md for setup steps.
  const googleServicesPath = path.join(__dirname, "google-services.json");
  const hasGoogleServicesFile = fs.existsSync(googleServicesPath);

  const android = { ...(config.android ?? {}) };
  if (hasGoogleServicesFile) {
    android.googleServicesFile = "./google-services.json";
  } else {
    delete android.googleServicesFile;
  }

  return {
    ...config,
    android,
    extra: {
      ...(config.extra ?? {}),
      apiBaseUrl,
      wsUrl,
    },
  };
};
