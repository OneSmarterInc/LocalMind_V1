# Device GPU inference

The web and native completion implementations passed `n_gpu_layers: 0`, explicitly disabling GPU inference for lessons, quizzes and tutor responses. The pinned wllama 3.6.1 already includes WebGPU; no new model download or inference service is needed.

## Changes

- Request up to 99 GPU layers (all layers of the bundled Qwen3 1.7B) in browser and native inference.
- Browser loading retries once on CPU after disposing a failed GPU worker. Browsers without a WebGPU API start on CPU. Cancellation disposes the loading worker and prevents retry.
- Browser GPU status requires the runtime's actual `offloaded N/M layers to GPU` diagnostic. The bundled WASM contains this diagnostic. Missing evidence is labeled unconfirmed, not GPU active. Raw runtime log contents are not forwarded to application logs.
- Native inference uses llama.rn's actual `gpu` and `reasonNoGPU` results and retries initialization on CPU if GPU initialization throws. Enable the llama.rn Expo plugin, including optional Android OpenCL access and iOS entitlements. Native applications must be rebuilt to receive native configuration changes.
- Progress, Offline AI status and timing diagnostics distinguish GPU, CPU and unconfirmed offloading. Source text, answers and prompts are not included in these diagnostics.
- Model, source validation, JSON schema decoding, inference queue, token limits and device-only processing remain in place. No server inference fallback is introduced.

## Deploy and verify

1. Pull the branch, run `npm ci` and `npm run export:web` inside `frontend`, then restart the serving application.
2. On each laptop, close existing LocalMind tabs and reopen the updated application over HTTPS. Refresh saved offline application files if using the offline copy. Keep the existing browser profile and model.
3. Generate a short lesson, quiz or tutor answer. Progress should show `GPU · N layers`; Offline AI shows the same runtime status after generation. The console's `[LocalMind AI]` entry reports accelerator, offloaded layers and elapsed generation time.
4. If CPU is reported, check browser hardware acceleration, current browser/graphics drivers and GPU memory availability. On a Windows laptop with multiple GPUs, the OS Graphics settings can select High performance for the browser; restart the browser afterward. The browser/driver controls the adapter exposed to WebGPU; application code cannot guarantee use of a particular discrete GPU.
5. Compare warm generations on the same model and source. Initial loading and shader compilation can take longer than subsequent generations. GPU does not accelerate every application operation (network transfer, storage, document parsing, etc.).

## Verification and limitations

Eight acceleration tests cover offload evidence, unavailable GPU, silent CPU fallback, missing evidence, failed GPU initialization, cleanup, cancellation and terminal errors. Existing private suites, TypeScript, lint, web export and Expo native configuration resolution passed. Hardware inference, native builds and browser end-to-end generation were not tested in this environment. No measured speedup is claimed.

References: https://github.com/ngxson/wllama#webgpu-support and the pinned llama.rn 0.10.0 README's GPU/Expo configuration sections.
