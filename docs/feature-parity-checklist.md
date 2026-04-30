# Privora Web -> Mobile Feature Parity

This checklist tracks the alignment between the web frontend (`Privora-GUI`)
and the mobile client (`Privora-Mobile`).

## Authentication
- Email/password sign-in via Firebase ✅
- Persisted auth (AsyncStorage) and silent token refresh ✅
- Email-verification gate on login ✅
- "Register here" external link to web register flow ✅
- Logout from profile menu ✅
- In-app registration / forgot-password flows ❌ (web also delegates register to a dedicated page; the link approach matches)

## WebSocket lifecycle
- `login` + `signal_session_claim` on open ✅
- 30 s heartbeat (`ping`) ✅
- Exponential reconnect, capped at 30 s ✅
- Auth error (`1008`) → logout, no reconnect ✅
- 3 rapid `1006` closes → forced logout (avoid loop) ✅
- `wsReady` reflected in chat header ("Reconnecting…" pill when down) ✅

## Contacts
- "Recent Chats" list with self-chat at the top ✅
- User search via `/search-users` (debounced 300 ms) ✅
- Presence updates via `presence` payload ✅
- Per-row online dot in drawer ✅
- Unread badge with `99+` cap ✅

## Conversation
- Click → opens chat, resets unread for that user ✅
- Auto-scroll to most recent message on send / receipt / chat switch ✅
- Empty placeholder when no chat is selected ✅
- Inbound `message`/`offline` payloads with optimistic upsert by `msg_id` ✅
- Inbound `history` payload merged per-message (no whole-key overwrite) ✅
- Failed sends are visible (`Failed - tap to retry`) ✅

## Messages and reactions
- Text messages with `msg_id`, optimistic UI ✅
- Long-press bubble → reaction picker (`👍 ❤️ 😂 😮 😢 🔥`) ✅
- Reaction send/receive over WS, displayed under bubble with counts ✅
- Tap bubble → toggle timestamp display ✅

## Attachments
- Image upload from gallery (`expo-image-picker`) ✅
- Camera capture (`expo-image-picker`) ✅
- Document upload (`expo-document-picker`) ✅
- Server endpoint `/api/upload`, 10 MB max, Bearer token ✅
- Image bubble with full-screen preview + save-to-disk ✅
- File bubble with tap-to-open ✅

## Voice messages
- Press-and-record UI with timer, cancel, send ✅
- Recorded as base64 m4a/AAC, sent as `__system_audio:` marker ✅
- Inline player on each side with cleanup on unmount ✅
- iOS reliability: data URLs are persisted to a tmp file before playback ✅

## Calls (WebRTC)
- Offer / answer / ICE state machine ✅
- Ringing, timeout (45 s), reject, end semantics ✅
- Mute toggle, speaker info alert (system routing) ✅
- Reconnect window (10 s) with `connection_lost` fallback ✅
- Call summary system messages (`__system_call:missed` / `__system_call:ended:mm:ss`) ✅
- Ringtones for `calling`, `ringing`, `calling_offline` ✅
- Vibration on incoming ringing ✅
- Native CallKit / ConnectionService integration ❌ (overlay only)

## Notifications
- Message-notification sound (`messenger.mp3`) when chat is not focused ✅
- Push notifications (FCM / APNs) ❌ (parity item; web also relies on focus + sound)

## UI / Theme
- Animated drawer for the contact list on phones ✅
- Profile menu (Settings / Logout) ✅
- WS status pill in header when reconnecting ✅
- Dark mode ❌ (web does not have it either)
