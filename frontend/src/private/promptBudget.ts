/** Prompt sizing for the on-device model.
 *
 * wllama 3.x exposes no tokenizer call, so the browser runtime estimates.
 * Qwen3 averages about 4 characters per English token; 3 is deliberately
 * pessimistic so OCR noise, numbers and symbols do not slip past the check.
 * Overflowing the context aborts wllama inside WebAssembly, which is far
 * worse than rejecting a prompt early with a readable error.
 */
import { CONTEXT_TOKENS } from './modelSpec';

export const CHARS_PER_TOKEN_ESTIMATE = 3;
export const CHAT_TEMPLATE_TOKENS = 64;
export const RESPONSE_MARGIN_TOKENS = 48;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function exceedsContext(system: string, prompt: string, maxTokens: number, context = CONTEXT_TOKENS): boolean {
  return estimateTokens(system) + estimateTokens(prompt) + CHAT_TEMPLATE_TOKENS + maxTokens + RESPONSE_MARGIN_TOKENS > context;
}

/** Wording is matched by the passage-halving retry in library.ts. Keep "exceeds" and "context". */
export const CONTEXT_OVERFLOW_MESSAGE = 'This prompt exceeds the local model context. Retrying with a shorter passage.';

/** The "do not repeat" list sent to the model. Duplicate checking in code
 * still compares against every question; this only bounds prompt size. */
export const AVOID_RECENT = 8;
export const AVOID_CHARS = 120;
export function avoidList(questions: string[]): string {
  return questions.slice(-AVOID_RECENT).map(q => q.slice(0, AVOID_CHARS)).join('\n');
}
