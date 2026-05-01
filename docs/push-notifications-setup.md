# Push notifications for incoming calls

This document explains how to enable background ringing on Android. Once
configured, the device will ring (with full sound, vibration, and lock-screen
banner) when someone calls you, even if the app is backgrounded or killed.

The full pipeline is already implemented:

- **Mobile** registers an FCM device token after login (see
  `src/services/pushNotifications.ts`) and sends it to the backend.
- **Backend** stores the token in memory (`server/src/push.py`) and uses
  `firebase-admin` to send a high-priority FCM message every time someone
  posts a `call_offer`.
- The notification opens the high-importance `incoming_call` channel, plays
  `ringing.mp3`, and includes a structured payload (`callId`, `from`,
  `fromDisplayName`) that the app reads to resume the call when the user
  taps it.

What is missing in your local checkout is a one-time Firebase configuration
step that we cannot commit (it depends on your Firebase project).

## Backend (already done)

`server/requirements.txt` already pulls in `firebase-admin`, and
`server/src/main.py` already calls `initialize_app()` with the service
account referenced by `FIREBASE_ADMIN_CREDENTIALS_JSON`. The same service
account is used to send FCM messages, so no new credential is required.

If you are not yet setting `FIREBASE_ADMIN_CREDENTIALS_JSON`, add it to your
`.env` (or `docker-compose` env) pointing at the JSON downloaded from
Firebase Console → Project Settings → Service Accounts → "Generate new
private key".

## Mobile (one-time setup)

### 1. Make sure FCM is enabled in your Firebase project

Firebase Console → Project Settings → "Cloud Messaging" tab. The "Cloud
Messaging API (V1)" must be enabled. If it is greyed out, follow the link
and enable it in the Google Cloud console.

### 2. Add the Android app in Firebase

Firebase Console → Project Settings → "Your apps" → "Add app" → Android.

- **Android package name**: must match `app.json > expo.android.package`.
  Today it is `com.anonymous.PrivoraMobile` - either reuse it or update
  both sides.
- SHA fingerprints are not required for FCM, only for Firebase Auth on
  Google Sign-In flows. You can leave them blank for now.

### 3. Download `google-services.json`

Once the Android app exists in Firebase, download `google-services.json`
and drop it at:

```
Privora-Mobile/google-services.json
```

This file is gitignored (see `.gitignore`).

### 4. Rebuild the dev client

```
npx expo prebuild --clean
npx expo run:android
```

`app.config.js` automatically wires `googleServicesFile` into the Expo
config when the JSON is present. The `expo-notifications` plugin also
bundles `assets/sounds/ringing.mp3` as the channel sound.

### 5. Verify

After login on a real device (FCM does not work on Expo Go and is unreliable
on emulators), watch the backend logs:

```
[PUSH] Registered android token for <email>
```

Then have a second account call this device while the app is backgrounded
or killed. You should see:

```
[PUSH] Sent incoming-call notification to <email> (callId=..., devices=1)
```

…and the device rings with the `incoming_call` channel sound.

## In-call audio routing (already working)

In addition to background ringing, the call UI now exposes a real
speaker / earpiece toggle backed by `react-native-incall-manager`. Tap the
ear / speaker icon in the active-call card to switch. Works for both
incoming and outgoing calls and falls back gracefully if the native module
is unavailable.

## Limitations of the v1 implementation

- Tokens are stored in process memory (`server/src/push.py`). For a
  multi-server deployment, persist them in Firestore or another shared
  store. The interface in `push.py` is intentionally tiny so swapping the
  backend is a small change.
- The notification uses Android's standard high-priority channel, not a
  full-screen call activity. That means the screen will not light up like
  a phone call, but the device will ring, vibrate, and show a high-priority
  heads-up banner. A future iteration can integrate
  `react-native-callkeep` (CallKit on iOS, ConnectionService on Android)
  for a true phone-call UI.
- iOS currently uses a regular alert notification (sound + banner). True
  CallKit integration is out of scope for this PR.
