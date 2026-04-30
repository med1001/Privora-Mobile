/**
 * API / WebSocket host for local development:
 *
 * - Android emulator (default): 10.0.2.2 → your PC's localhost from the AVD.
 * - Physical phone on same Wi‑Fi: set EXPO_PUBLIC_API_HOST to your PC's LAN IP
 *   (ipconfig → IPv4, e.g. 192.168.1.42). Allow port 8000 in Windows Firewall.
 * - Physical phone over USB (same URLs as emulator idea): set EXPO_PUBLIC_API_HOST=127.0.0.1
 *   and run: adb reverse tcp:8000 tcp:8000   (+ tcp:8081 for Metro if needed)
 *
 * Rebuild the native app after changing EXPO_PUBLIC_API_HOST (expo run:android).
 */
module.exports = ({ config }) => {
  const host = (process.env.EXPO_PUBLIC_API_HOST || "10.0.2.2").trim();
  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),
      apiBaseUrl: `http://${host}:8000`,
      wsUrl: `ws://${host}:8000/ws`,
    },
  };
};
