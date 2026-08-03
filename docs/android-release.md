# Android release checklist

Privora uses two installable variants from the same codebase:

- Play Store: `com.privora.mobile` (`Privora`)
- Local/EAS development: `com.privora.mobile.debug` (`Privora Dev`)

## One-time Firebase migration

1. Open Firebase Console and select the `privora-61d4d` project.
2. Add Android apps for `com.privora.mobile` and
   `com.privora.mobile.debug` in that same Firebase project.
3. After both apps are registered, download a fresh `google-services.json`.
4. Confirm that the file contains a client entry for both package names.
5. Put the file at the project root: `Privora-Mobile/google-services.json`.
6. Do not reuse or rename the old configuration registered for
   `com.anonymous.PrivoraMobile`.

The Firebase file contains client configuration rather than an Admin SDK
private key. It is included in the app bundle by design. Never put
`firebase_credentials.json` or another Admin SDK credential in this repo.

## Local development build after the package change

The `android/` directory is generated and ignored by Git. After the new
Firebase file is present, regenerate it and reinstall the app:

```powershell
npx expo prebuild --clean --platform android
npx expo run:android
```

The new debug package is a different Android application, so remove the old debug
installation when it is no longer needed:

```powershell
adb uninstall com.anonymous.PrivoraMobile
```

## Signed Play Store bundle with EAS

The `production` profile in `eas.json` creates an Android App Bundle and lets
EAS manage the upload keystore securely.

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile production
```

On the first production build, accept the option to generate a new Android
keystore. Store a secure backup of any credentials offered for download.

Upload the resulting `.aab` in Play Console under **Testing > Internal
testing**. Each later upload must use the same application ID and signing
identity and a higher Android version code. The production profile uses EAS
remote versioning and auto-increments that code.

## Release gates

- `https://www.privora-app.com/privacy` is publicly reachable without login.
- `https://www.privora-app.com/delete-account` is publicly reachable and its
  request form reaches the production backend.
- Account deletion works from Settings on web and Android.
- The Play Console contact email `privora.support.app@gmail.com` is verified
  and monitored.
- Production API and WebSocket traffic uses HTTPS/WSS; cleartext Android
  traffic remains disabled.
- Play Console Data safety answers match the deployed application and SDKs.
- Store listing, screenshots, content rating, app access instructions and
  permission declarations are complete.
