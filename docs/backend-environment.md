# Backend URL (production vs local)

The mobile app reads API and WebSocket URLs from **`app.config.js`**, which writes them into `expo.extra` at **native build time**. They are **not** picked up from Metro alone — after changing env vars you must rebuild the dev client:

```bash
npx expo run:android
# or
npx expo run:ios
```

Runtime reads those values from `src/config/env.ts` (`config.apiBaseUrl`, `config.wsUrl`). Background handlers (`incomingCallActions.ts`, `index.ts`) use the same `expo.extra.apiBaseUrl`.

---

## Production (default)

With **no** `.env.local` (and no conflicting env vars), the app targets:

| Setting   | Value |
|-----------|--------|
| REST API  | `https://privora-app.com` |
| WebSocket | `wss://privora-app.com/ws` |

This matches a typical EC2 setup where Nginx terminates TLS and proxies `/` and `/ws` to the FastAPI backend.

### If your API lives on another host or path

Set a **full base URL** (recommended when production is not exactly `https://privora-app.com`):

Create **`.env.local`** in the project root (same folder as `app.json`). This file should stay untracked (add to `.gitignore` if needed).

```bash
# Example: API on a subdomain
EXPO_PUBLIC_API_BASE_URL=https://api.privora-app.com
```

The WebSocket URL is derived automatically: `https:` → `wss:` and `/ws` appended → `wss://api.privora-app.com/ws`.

If your WebSocket is **not** at `{origin}/ws`, you would need a small code change in `app.config.js` to support a separate `EXPO_PUBLIC_WS_URL` — today only `EXPO_PUBLIC_API_BASE_URL` is supported for full-URL override.

Then rebuild the native app.

---

## Local development (Docker / machine on LAN)

### Option A — one variable (simplest)

Point everything at your machine’s HTTP API (same port as your local compose file, often **8000**):

```bash
# Android emulator → host PC
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000

# Physical phone on Wi‑Fi → replace with your PC’s LAN IP from ipconfig
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:8000

# USB with adb reverse (tcp:8000 on device → PC)
# EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
# Then: adb reverse tcp:8000 tcp:8000
```

Rebuild.

### Option B — host + port + TLS flag

```bash
EXPO_PUBLIC_API_HOST=192.168.1.42
EXPO_PUBLIC_API_PORT=8000
EXPO_PUBLIC_API_USE_TLS=false
```

Omitting `EXPO_PUBLIC_API_USE_TLS` while using a **numeric IP** selects **HTTP** on that host/port.

---

## Quick reference

| Goal | What to set |
|------|-------------|
| Production `privora-app.com` | Nothing, or `EXPO_PUBLIC_API_BASE_URL=https://privora-app.com` |
| Local emulator | `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000` |
| Local phone + Wi‑Fi | `EXPO_PUBLIC_API_BASE_URL=http://<PC-LAN-IP>:8000` |
| Force HTTPS + default port 443 | `EXPO_PUBLIC_API_HOST=privora-app.com` + no port (TLS auto for non-IP hosts) |

---

## Troubleshooting

- **401 / connection errors after switching**: Confirm Firebase Auth and API URL match the **same** environment (production Firebase project vs local backend).
- **Cleartext HTTP blocked**: Android allows cleartext in this project for dev; production should use **HTTPS**.
- **Push / incoming-call HTTP helpers**: They use the same `apiBaseUrl` — registration and `/api/calls/...` endpoints must be reachable from the device.
