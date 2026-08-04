# Privora Mobile - Quick Development Workflow

Run commands from:

```powershell
cd C:\Users\homepc\Desktop\privora_project\Privora-Mobile
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
```

## 1. Daily development with Metro

Use this for normal JavaScript and TypeScript work. Changes reload quickly.

```powershell
& $adb devices
& $adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --localhost --port 8081
```

Then press `a` in the Expo terminal or open **Privora Dev** manually.

Keep the terminal running. This development version needs Metro and the laptop.

## 2. Install or rebuild the local development app

Run this the first time, or after changing a native dependency, Firebase config,
permissions, app package, icon, or Expo plugin:

```powershell
npx expo run:android
```

For ordinary screen or business-logic changes, keep using Metro instead.

## 3. Use a local backend through USB

Only when the app was built to use `http://127.0.0.1:8000`:

```powershell
& $adb reverse tcp:8000 tcp:8000
```

The backend URL is embedded during the native build, so changing it requires
running `npx expo run:android` again.

## 4. Create a standalone preview APK

Use this when a group of features looks stable and should be tested without
Metro, USB, or the laptop:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

After the upload finishes and EAS says the build is queued, `Ctrl+C` only stops
waiting in the terminal. The cloud build continues.

Check recent builds:

```powershell
npx eas-cli@latest build:list --platform android --limit 5
```

Check one build:

```powershell
npx eas-cli@latest build:view BUILD_ID
```

Download the resulting `.apk` from its Expo page and install it on the phone.
The preview app is **Privora Dev** (`com.privora.mobile.debug`) and runs without
Metro.

The local Metro build and EAS preview use different signing keys. When Android
reports a signature conflict, uninstall only **Privora Dev** and install the
required version again. This removes local app data, not the server account.

## 5. Create the Google Play production build

Only after the preview APK has passed extended testing:

```powershell
npx eas-cli@latest build --platform android --profile production
```

This produces a signed `.aab` for `com.privora.mobile`. An AAB is uploaded to
Google Play Console and cannot be installed directly like an APK.

## 6. Capture an Android crash

```powershell
& $adb logcat -c
& $adb shell am force-stop com.privora.mobile.debug
& $adb shell am start -n com.privora.mobile.debug/.MainActivity
& $adb logcat ReactNativeJS:V ReactNative:V AndroidRuntime:E '*:S'
```

Reproduce the issue, then press `Ctrl+C`. Redact tokens, email addresses, and
private messages before sharing logs.

## Recommended cycle

```text
Metro development
  -> local phone tests
  -> standalone preview APK
  -> extended real-world tests
  -> production AAB
  -> Google Play internal testing
```

## Application identities

| Purpose | Name | Android package | Needs Metro |
| --- | --- | --- | --- |
| Local development | Privora Dev | `com.privora.mobile.debug` | Yes |
| Preview APK | Privora Dev | `com.privora.mobile.debug` | No |
| Google Play | Privora | `com.privora.mobile` | No |

