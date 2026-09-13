import { initLlama, type LlamaContext } from "llama.rn";
import { prepare, validateOutput, type LocalSourceStore, type Request } from "./prompts";

export class SpikeRuntime {
  private context: LlamaContext | null = null;
  private busy = false;
  private loadMs = 0;
  private cancelled = false;
  private settings = { contextTokens: 2048, threads: 2, outputTokens: 256 };
  async load(uri: string) {
    if (this.busy) throw new Error("A benchmark is running.");
    if (!uri.startsWith("file://")) throw new Error("Import a local GGUF file first. Network model URLs are not accepted.");
    this.busy = true;
    try {
      if (this.context) { await this.context.release(); this.context = null; }
      const started = performance.now();
      this.context = await initLlama({ model: uri, n_ctx: this.settings.contextTokens, n_threads: this.settings.threads,
        n_gpu_layers: 0, use_mlock: false });
      this.loadMs = performance.now() - started;
      return { modelLoadMs: Math.round(this.loadMs), gpu: this.context.gpu, ...this.settings };
    } finally { this.busy = false; }
  }
  async run(store: LocalSourceStore, request: Request) {
    if (!this.context) throw new Error("Load a model before running the benchmark.");
    if (this.busy) throw new Error("Run one benchmark at a time.");
    this.busy = true;
    this.cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const input = await prepare(store, request);
      const prompt = await this.context.getFormattedChat(input.messages, undefined, { enable_thinking: false });
      const tokenized = await this.context.tokenize(prompt.prompt);
      if (tokenized.tokens.length + this.settings.outputTokens + 32 > this.settings.contextTokens) {
        throw new Error("The stored block plus response exceeds the configured context. Split the block upstream; it was not truncated.");
      }
      if (this.cancelled) throw new Error("Benchmark cancelled before generation.");
      const started = performance.now();
      let firstToken: number | null = null;
      timer = setTimeout(() => { timedOut = true; void this.context?.stopCompletion().catch(() => {}); }, 120000);
      const result = await this.context.completion({ messages: input.messages, n_predict: this.settings.outputTokens,
        temperature: 0, enable_thinking: false, response_format: { type: "json_object", schema: input.schema },
        stop: ["<|im_end|>", "<|eot_id|>", "</s>"],
      }, (event) => { if (event.token && firstToken === null) firstToken = performance.now() - started; });
      if (this.cancelled) throw new Error("Benchmark cancelled; no partial response was accepted.");
      if ("stopped_limit" in result && result.stopped_limit) throw new Error("Response reached its output limit and was not accepted.");
      if (timedOut) throw new Error("Benchmark timed out. The partial response was not accepted.");
      const completionMs = performance.now() - started;
      const output = validateOutput(input, result.text);
      return { output, metrics: { modelLoadMs: Math.round(this.loadMs),
        firstTokenMs: firstToken === null ? null : Math.round(firstToken), completionMs: Math.round(completionMs),
        inputTokens: tokenized.tokens.length, sourceChars: input.block.text.length, blockId: input.block.id,
        blockRevision: input.block.revision, ...this.settings, structuredOutputValid: true,
        factualCorrectness: "not_measured", memoryHeadroom: "not_measured_use_adb", gpu: this.context.gpu } };
    } finally { if (timer) clearTimeout(timer); this.busy = false; }
  }
  async stop() { this.cancelled = true; await this.context?.stopCompletion(); }
  async close() {
    if (this.busy) throw new Error("Stop the benchmark and wait for it to finish before releasing the model.");
    if (this.context) { await this.context.release(); this.context = null; }
  }
}
