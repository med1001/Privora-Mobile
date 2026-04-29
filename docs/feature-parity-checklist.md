# Privora Web -> Mobile Feature Parity

This checklist maps the web app features to the current mobile implementation.

## Implemented in this pass

- Firebase login is now gated by email verification (same rule as web).
- WebSocket client now supports:
  - exponential reconnect
  - heartbeat ping every 30 seconds
  - outbound buffering for non-transient events
  - transient call-related event drop while offline
  - close-code `1008` queue reset behavior
- Chat session now handles:
  - `message` and `offline` inbound payloads
  - `contacts`, `history`, and `presence` updates
  - `reaction` payload merge into message state
  - unread counts per chat with reset when chat is selected
- Chat UI now supports:
  - unread badges in sidebar
  - connection status label (`Connected` / `Connecting...`)
  - message timestamp toggle on tap
  - reaction picker on long-press + reaction rendering
  - protocol marker rendering for:
    - `__system_image:`
    - `__system_file:`
    - `__system_audio:`
    - `__system_call:`
- API layer now includes authenticated upload helper for `/api/upload`.

## Still pending for full web parity

- Full WebRTC call flow parity:
  - offer/answer/ICE state machine
  - ringing/timeout/reject/end semantics
  - reconnect handling and call overlay states
- Real file/image/audio capture and send UX using native pickers/recording.
- Registration screen parity (web has dedicated register flow and email verification send flow).
- Audio notification parity (`messenger.mp3`) for background incoming messages.
- Final visual micro-parity tweaks (all spacing/animations to match web exactly).
