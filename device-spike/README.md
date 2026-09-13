# LocalMind device spike

**Engineering prototype, not the completed private student runtime.** This implements the first experiment required by the 5 September 2026 Architecture Guidelines. Do not freeze a production content-package specification or approve device support from this source alone.

This is a separate native app. It does not replace or import the classroom app's authentication, API client, grade collection, analytics or offline synchronization. It has no network requests or automatic uploads in its application code. All test questions and answers are synthetic fixtures. No model weights are included.

## What the code does

It seeds one source block and one practice rubric into on-device SQLite. It resolves the block/question by ID from that store; caller-supplied source text or rubrics are not used. It performs the two bounded tasks in the guideline: explain a stored block, and give qualitative feedback on a short answer against a stored rubric. There are no grades or percentages and no question generation.

The output grammar and subsequent structural/quote checks reject malformed output, invented rubric IDs and contradictory feedback. These checks **do not establish factual accuracy**. Model quality must be reviewed by a person using the synthetic cases.

Measurements include model loading, time to first streamed token and completion time. The first streamed token can be a JSON delimiter, so it is not the time to first visible teaching sentence. Input bounds are checked before inference; the code refuses an overlarge block instead of silently cutting it. Native generation is serialized and can be stopped.

The fixed 2,048-token context, two CPU threads, 256-token output cap and CPU-only inference are initial experimental settings, not a decision about final model size, quantization, or supported phones.

## Build locally

Use a separate terminal and the native toolchain already needed for Android builds. Node 22, JDK 17 and a configured Android SDK are suitable starting points for the existing Expo 54 / React Native 0.81 family. The code pins `llama.rn` 0.10.0, whose documentation requires the New Architecture; `app.json` enables it explicitly. Native compatibility has NOT been built or tested in the authoring environment.

```powershell
cd device-spike
npm install
npm run typecheck
npx expo run:android --device
```

Use an Android device or iOS native build, **not Expo Go**. No cloud build or API key is required. `npm install` is needed only for the development/build environment. Commit the resulting lockfile only after validating the native build; no invented lockfile is provided here.

Copy an appropriate GGUF chat model onto the phone, open the app, and select **Choose and load GGUF**. The file is copied to the app's private directory. Selectable text is not sent to any server. To verify fully disconnected operation, build a standalone release before unplugging the development server:

```powershell
npx expo run:android --device --variant release
```

A normal debug build can still need Metro to load its JavaScript. That is different from whether model inference needs the internet.

## Measurement procedure

Start with the app open but no model loaded. On your computer, run:

```powershell
python scripts/capture_memory.py --serial YOUR_ADB_SERIAL --samples 120 --interval 2 --output reports/memory-first-run.jsonl
```

Run a cold model load, the explanation case, three repeated warm explanations, the out-of-source question, the prepared correct answer and the prepared misconception. Repeat on representative older and newer target phones. Record OS, RAM, model name/quantization, thermal state and whether the run was cold or warm alongside the results. The app does not guess those facts.

The script records process PSS from `adb shell dumpsys meminfo`. PSS is NOT the same as available device RAM, and the script does not invent a memory-headroom result. Inspect whole-device memory and repeat under realistic memory pressure before approving a phone. An unavailable measurement remains `null` with a reason.

Use **Share benchmark metadata manually** for an explicit local export. No automatic transmission is configured. The export includes timing/configuration and fixture references, not responses, learner history or grades. **Delete benchmark measurements** clears stored timings. Avoid using real learner data in this spike.

## Still required after the spike

The five teaching moves and their authored assets, persistent private learner model, production content blocks/figures, reviewed large-model bank, signed version-pinned packages, opt-in anonymous move-outcome reporting, and upstream policy improvement loop are not implemented by this spike. The specification for those comes after the actual-device measurements, as the guideline says.

## API references used

- Expo SDK 54: https://expo.dev/sdk/54
- Expo SQLite 54: https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/
- Expo FileSystem 54: https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/
- llama.rn 0.10.0: https://github.com/mybigday/llama.rn/blob/v0.10.0/README.md

These references inform the prototype; they are not evidence that this app has passed a native build or that the selected model is appropriate for your phones.
