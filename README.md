# Privora Mobile (React Native)

Privora Mobile is the native React Native client for Privora, aligned with the
web application and backend contracts:

- Firebase Authentication
- REST APIs for search, uploads, profile settings, support, push registration,
  and WebRTC configuration
- WebSocket chat, presence, reactions, history, and WebRTC signaling
- Android FCM + Notifee incoming-call notifications

## 1) Install dependencies

```bash
npm install
```

## 2) Configure app credentials

Copy environment template:

```bash
cp .env.example .env
```

Set in `.env`:

- `EXPO_PUBLIC_FIREBASE_API_KEY`

Edit `app.json` under `expo.extra`:

- `apiBaseUrl`
- `wsUrl`
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

- Firebase login, registration, verification gate, and password reset
- Chat, presence, unread counts, reactions, and retryable sends
- Image/document attachments and voice messages
- Audio calls with WebRTC, TURN support, mute/speaker controls, and call history
- Incoming-call push notifications with Answer/Decline actions
- Profile photo, contact-support, and issue-report settings
- Public privacy/deletion information and authenticated account deletion

## Production work still required

See [the Android release checklist](docs/android-release.md) for Firebase,
signing, EAS Build and Play Console preparation.

1. Add automated tests and CI checks.
2. Integrate Android ConnectionService (and iOS CallKit when iOS work starts).
3. Persist backend FCM tokens and call state in shared storage.
