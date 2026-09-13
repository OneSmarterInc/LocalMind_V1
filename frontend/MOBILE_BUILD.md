# Building the LocalMind phone apps

The frontend is one Expo codebase; the phone apps are the same screens you run on the web, compiled into an installable APK/AAB (Android) or IPA (iOS). Nothing in the app changes between targets except the base URL of the backend, which is baked in at build time.

## 1. Point the app at your server

The app reads `EXPO_PUBLIC_API_URL` at build time and falls back to `extra.apiUrl` in `app.json`. Phones cannot reach `127.0.0.1`, so set the LAN address (or public hostname) of the Django server in the profile you build with. `eas.json` carries a placeholder `http://192.168.1.20:8000` in the `development` and `preview` profiles and an `https://` placeholder in `production`; edit those before building. Plain `http://` is allowed on both platforms (`usesCleartextTraffic` on Android, `NSAllowsArbitraryLoads` on iOS) because most campus deployments run without TLS. Remember the backend's `DJANGO_CORS_ALLOWED_ORIGINS` and `ALLOWED_HOSTS` must accept that address.

## 2. Fastest way to see it on a phone (no build)

```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8000 npx expo start
```

Install **Expo Go** from the Play Store / App Store, scan the QR code, and the app loads on the device over Wi-Fi. Every library this project uses (router, secure store, document picker, linear gradient) ships inside Expo Go for SDK 54, so no custom client is needed for testing.

## 3. Installable build with EAS (recommended)

EAS Build compiles in the cloud, so you need neither Android Studio nor a Mac for Android, and only an Apple developer account for iOS.

```bash
npm install -g eas-cli
eas login                      # free Expo account
eas init                       # writes the real projectId into app.json
npm run build:android          # preview profile -> downloadable .apk
npm run build:ios              # preview profile -> .ipa for TestFlight / ad-hoc
npm run build:all              # production profile -> .aab + App Store build
```

The `preview` profile produces a sideloadable APK you can hand to students directly. The `production` profile produces an App Bundle for Google Play and increments version numbers automatically. Identifiers are already set: `com.onesmarter.localmind` on both platforms; change them in `app.json` if your institution needs its own.

## 4. Local build without EAS

`android/` and `ios/` are already generated (`npx expo prebuild`) and checked in for convenience. To rebuild them from scratch after changing `app.json`, run `npm run prebuild`.

Android: open `android/` in Android Studio (or run `cd android && ./gradlew assembleRelease`) and the APK lands in `android/app/build/outputs/apk/release/`. Sign it with your own keystore for distribution; the debug build installs as-is on a developer-mode phone. Or simply `npm run android` with a device plugged in.

iOS: `cd ios && pod install`, open `LocalMind.xcworkspace` in Xcode, select your team under Signing & Capabilities, and Archive. Or `npm run ios` for a simulator run on a Mac.

## 5. What was configured for mobile

`app.json` now carries the bundle identifier and package name, version codes, dark UI style, a navy (`#080F13`) splash and adaptive-icon background matching the theme, network permissions, `softwareKeyboardLayoutMode: resize` so forms scroll above the keyboard, and the `expo-build-properties` plugin for the cleartext/deployment-target settings. `eas.json` defines the three build profiles above. The shell already adapts to phones: tabs move to a dark bottom bar, the header shrinks and shows the brand mark, and safe-area insets are respected on notched devices.

## Not done here

This sandbox has no Android SDK, Java or Apple toolchain and cannot reach Google's Maven repository, so the APK/IPA themselves were not compiled. Everything up to that step (config, prebuild of both native projects, typecheck, lint, web export) has been run and is clean.
