import { initLlama, type LlamaContext } from 'llama.rn';
import { requireThat, type LocalModel, type ModelRequest } from './core';

/** One bounded model call at a time. No server fallback and no remote model URI. */
export class DeviceModel implements LocalModel {
  private context: LlamaContext | null = null;
  private busy = false;
  private stopped = false;
  async load(uri: string) {
    requireThat(uri.startsWith('file://'), 'Choose a model stored on this device');
    requireThat(!this.busy, 'Finish or stop the current model request first');
    this.busy = true;
    try {
      if (this.context) { await this.context.release(); this.context = null; }
      this.context = await initLlama({ model: uri, n_ctx: 2048, n_threads: 2, n_gpu_layers: 0, use_mlock: false });
    } finally { this.busy = false; }
  }
  async complete(request: ModelRequest): Promise<unknown> {
    requireThat(this.context, 'Load a local model in Setup. Reading and MCQ practice do not need a model.');
    requireThat(!this.busy, 'The local model is already working');
    this.busy = true; this.stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const formatted = await this.context.getFormattedChat(request.messages, undefined, { enable_thinking: false });
      const prompt = await this.context.tokenize(formatted.prompt);
      requireThat(prompt.tokens.length + request.maxTokens + 32 <= 2048, 'This source and answer exceed the device context. Ask the author to split the block; no source was silently truncated.');
      requireThat(!this.stopped, 'Request cancelled');
      let expired = false;
      timer = setTimeout(() => { expired = true; void this.context?.stopCompletion().catch(() => {}); }, 120000);
      const result = await this.context.completion({ messages: request.messages, temperature: 0, n_predict: request.maxTokens,
        enable_thinking: false, response_format: { type: 'json_object', schema: request.schema }, stop: ['<|im_end|>', '<|eot_id|>', '</s>'] });
      requireThat(!expired && !this.stopped, 'The local request stopped. A partial answer was not accepted.');
      requireThat(!('stopped_limit' in result && result.stopped_limit), 'The response reached the limit and was not accepted.');
      return JSON.parse(result.text);
    } finally { if (timer) clearTimeout(timer); this.busy = false; }
  }
  async stop() { this.stopped = true; await this.context?.stopCompletion(); }
  async close() { requireThat(!this.busy, 'Wait for the current model call to stop'); if (this.context) { await this.context.release(); this.context = null; } }
}
