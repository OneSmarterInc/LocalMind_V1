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

Android: for tester APKs, signing and permissions, follow **Tester APKs from a Windows laptop** below. Don't hand out debug-signed builds.

iOS: `cd ios && pod install`, open `LocalMind.xcworkspace` in Xcode, select your team under Signing & Capabilities, and Archive. Or `npm run ios` for a simulator run on a Mac.

Because `android/` and `ios/` are committed, EAS builds them as they are and does not re-apply `app.json`. A change to icons, splash, permissions or plugin options in `app.json` only reaches the apps after the matching folder is regenerated and committed. Regenerate one platform at a time and review the diff before committing:

```bash
npx expo prebuild --platform android --clean --no-install
EAS_BUILD_PROFILE=production npx expo prebuild --platform ios --clean --no-install
```

The `EAS_BUILD_PROFILE=production` part matters for iOS: the `llama.rn` plugin only writes the increased-memory-limit and extended-virtual-addressing entitlements (needed for the on-device model) when it sees the production profile, and it also adds the C++20 settings the library needs to compile. On Windows PowerShell set it first with `$env:EAS_BUILD_PROFILE="production"`.

## Tester APKs from a Windows laptop (exact steps)

This is how tester APKs are built today. Run it in PowerShell from `frontend`:

```powershell
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
npm ci
$env:EXPO_PUBLIC_API_URL = "https://localmind.onesmarter.com"
$env:NODE_ENV = "production"
cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`.

- **ABIs:** `arm64-v8a` only. That covers 64-bit Android phones from about 2017 on. It leaves out old 32-bit phones and x86 emulators; drop the `-PreactNativeArchitectures` flag to build all four ABIs listed in `android/gradle.properties` (a much larger APK).
- **Minimum Android version:** 7.0 (API 24). Target: API 36.
- **If `npm ci` says EBUSY**, a Gradle daemon still holds files in `node_modules`: run `.\gradlew.bat --stop` in `android` (or close Android Studio) and try again.

### Version numbers

Android installs an update only when its `versionCode` is higher. Before each build you hand out, raise **both** in the same commit:

- `app.json`: `expo.version` (for example `1.0.2`) and `expo.android.versionCode` (for example `3`)
- `android/app/build.gradle`: `versionName` and `versionCode` to the same values

`tests/android-release.mjs` fails if the two files disagree. EAS tester builds (`npm run build:android`) raise the build number on their own (`autoIncrement` in `eas.json`). **My profile** shows the version and the git commit (for example `LocalMind Version 1.0.1 · a1b2c3d`), so testers can say which build they have.

### Signing with your own upload key

**Current policy (1 Oct 2026):** tester APKs are signed with the Android debug key, and every tester APK is built **on the same laptop**, so each new build installs over the last one and testers keep their downloaded AI model and offline data. The Gradle line "LocalMind: no upload key configured; release builds are signed with the debug key" is therefore expected. Create the upload key below **only when preparing a Google Play release**; until then, nothing in this section needs doing. If tester builds ever have to come from a second laptop, create the key first and use it on both.

Release builds are signed with the key named in **your own** `~/.gradle/gradle.properties`. Without it they fall back to the public Android debug key and Gradle prints a warning; Google Play refuses those, and a debug-signed APK built on one laptop will not install over one built on another.

One time, create the key **outside the repository** (keytool comes with Android Studio's JDK):

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore C:\keys\localmind-upload.jks -alias localmind -keyalg RSA -keysize 2048 -validity 10000
```

Then add to `C:\Users\<you>\.gradle\gradle.properties` (create the file if needed):

```
LOCALMIND_UPLOAD_STORE_FILE=C:/keys/localmind-upload.jks
LOCALMIND_UPLOAD_STORE_PASSWORD=your-store-password
LOCALMIND_UPLOAD_KEY_ALIAS=localmind
LOCALMIND_UPLOAD_KEY_PASSWORD=your-key-password
```

- **Never commit the `.jks` file or these passwords.** Back up the keystore and its passwords somewhere safe: losing it means the app can no longer be updated in place.
- **Switching keys is one-way for testers.** The first APK signed with the new key will not install over a debug-signed one. Testers uninstall once, which removes their downloaded AI model and offline data, then install the new build.
- Check the result: `apksigner verify --print-certs app-release.apk` must **not** show `CN=Android Debug`. Record the SHA-256 fingerprint it prints.
- For EAS builds, run `eas credentials` once for Android instead; EAS keeps the key and signs with it.

The signing setup lives in `plugins/withReleaseSigning.js`, so it survives `npm run prebuild` (`expo prebuild --clean`), which deletes and regenerates `android/`.

### iOS version numbers

The iOS build carries the same version as Android. Raise them together: `app.json` → `expo.version` and `expo.ios.buildNumber`, `ios/LocalMind/Info.plist` → `CFBundleShortVersionString` and `CFBundleVersion`, and `ios/LocalMind.xcodeproj/project.pbxproj` → `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` (both build configurations). `tests/android-release.mjs` checks they agree.

### Google Play: foreground service declaration

LocalMind declares a foreground service of type **specialUse** so lesson, quiz and answer writing keeps going when the person switches apps. Google Play asks for a justification in the Play Console (App content → Foreground service permissions) before release. Text to use:

> LocalMind writes lessons, quizzes and answers with an AI model that runs entirely on the phone; nothing is sent to a server. Writing one lesson takes one to several minutes. While it runs, LocalMind shows an ongoing notification naming the work ("Writing lessons — Chapter 4") with its progress, so the person can switch apps without losing it. The service starts only when the person starts that work, stops as soon as it finishes or is cancelled, and is never started in the background on its own. No other foreground service type fits on-device AI generation.

The manifest's subtype text (`PROPERTY_SPECIAL_USE_FGS_SUBTYPE`) says the same in one line. The video the Console asks for can be a screen recording of starting a book's generation, switching apps, and the notification updating.

### Permissions in the release build

`SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are blocked in `app.json` (`android.blockedPermissions`) and removed in `android/app/src/main/AndroidManifest.xml`. Drawing over other apps is only for the React Native developer menu, which the debug manifests declare. Save to Files uses the Storage Access Framework and model import uses the file picker, so no storage permission is needed. Check a build with:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\<version>\aapt.exe" dump permissions app-release.apk
```

If you change native settings, put them in `app.json` or a plugin in `plugins/`, not only in `android/`: `npm run prebuild` regenerates that folder from `app.json`.

## iOS builds from Windows

EAS compiles iOS on Expo's Macs, so Windows is enough, but device builds need a paid Apple Developer Program membership (a free Apple ID cannot sign builds for other devices).

```powershell
cd frontend
npx eas-cli@latest build --platform ios --profile production   # sign in with the Apple account; let EAS manage certificates
npx eas-cli@latest submit --platform ios --latest              # uploads to App Store Connect for TestFlight
```

For the iOS Simulator on a Mac, use `npx eas-cli@latest build --platform ios --profile simulator`, download the `.tar.gz`, unpack it and drag `LocalMind.app` onto the running Simulator. This is a release build with the JavaScript embedded, so no Metro packager is needed. A Debug build (Xcode's default Run, or `npx expo run:ios` without `--configuration Release`) loads JavaScript from Metro instead, and fails with "No script URL provided" unless `npx expo start` is running. The on-device AI must still be tested on a real iPhone: the Simulator does not reflect iPhone memory limits or Metal GPU speed.

TestFlight needs no device registration. The `preview` profile is ad hoc instead: register each iPhone or iPad first with `npx eas-cli@latest device:create`, then `npx eas-cli@latest build --platform ios --profile preview`. On iOS, Save CSV and Save template open the share sheet (Save to Files, AirDrop, Mail); on Android they open the folder picker.

## 5. What was configured for mobile

`app.json` now carries the bundle identifier and package name, version codes, dark UI style, a navy (`#080F13`) splash and adaptive-icon background matching the theme, network permissions, `softwareKeyboardLayoutMode: resize` so forms scroll above the keyboard, and the `expo-build-properties` plugin for the cleartext/deployment-target settings. `eas.json` defines the three build profiles above. The shell already adapts to phones: tabs move to a dark bottom bar, the header shrinks and shows the brand mark, and safe-area insets are respected on notched devices.

## Not done here

This sandbox has no Android SDK, Java or Apple toolchain and cannot reach Google's Maven repository, so the APK/IPA themselves were not compiled. Everything up to that step (config, prebuild of both native projects, typecheck, lint, web export) has been run and is clean.

## Generation while using other apps

On-device generation keeps running when the person switches to another app (`modules/localmind-background`, used by `src/private/backgroundWork.native.ts`). It is autolinked: after pulling, run `npm install`, and on a Mac `cd ios && pod install`. EAS does both.

- Android: a "LocalMind is generating" notification with progress (a foreground service of type `specialUse`) keeps the app running, GPU included. Android 13+ asks once for notification permission; if refused, generation still continues, without the visible notification. The Play Console will ask why the app uses a special-use foreground service: "On-device AI writes the lessons and quizzes the person asked for; the service runs only until that generation finishes."
- iOS 26 and later: iOS shows a system progress bar and keeps generating in other apps. The build must be made with Xcode 26 or later; an older Xcode builds fine but pauses instead. Without background GPU access the model continues on the CPU off screen (slower) and returns to the GPU on screen.
- Older iOS, or when iOS ends the task early: the answer pauses off screen and continues by itself when LocalMind is opened again. Nothing needs pressing.
- Laptop: the browser tab is marked busy while generating and asks before it is closed or refreshed.

Background GPU on iPhone (optional, same speed off screen): enable the Background GPU Access capability for `com.onesmarter.localmind` in the Apple Developer portal, set `"gpuInBackground": true` for `./plugins/withBackgroundGeneration` in `app.json`, then regenerate `ios/` as described above. Do not set it before the capability exists: the signed build would be rejected.

QA on a real phone: start a lesson generation, switch to another app for two minutes, come back. Expect: Android notification with progress, iOS 26 progress bar at the top, older iOS "Paused while LocalMind is in the background" then automatic continuation on return. In every case the lesson finishes without pressing generate again.
