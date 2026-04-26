# Privora Mobile (React Native)

This project is the mobile starter app for Privora chat, aligned with the existing web contract:

- Firebase Authentication
- REST: `/search-users`
- WebSocket: `/ws` with JSON message types (`login`, `message`, `history`, `contacts`, `presence`)

## 1) Install dependencies

```bash
npm install
```

## 2) Configure app credentials

Edit `app.json` under `expo.extra`:

- `apiBaseUrl`
- `wsUrl`
- `firebaseApiKey`
- `firebaseAuthDomain`
- `firebaseProjectId`
- `firebaseStorageBucket`
- `firebaseMessagingSenderId`
- `firebaseAppId`

For Android emulator, keep backend host as `10.0.2.2` for localhost APIs from your PC.

## 3) Run

```bash
npm start
```

Then press:

- `a` for Android
- `w` for web preview (limited compared to mobile)

## Current scope

- Firebase email/password login
- Chat list + user search via REST
- Chat room + send/receive messages via WebSocket
- Presence/contact/history payload handling

## Next implementation steps

1. Add register/forgot password screens.
2. Add unread counters + notifications.
3. Add attachment upload endpoint integration.
4. Add calling layer (WebRTC + push + incoming call UI).
