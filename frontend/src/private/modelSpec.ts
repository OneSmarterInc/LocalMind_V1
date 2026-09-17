// Pinned publisher file pointer verified 2026-09-17. Verify the bytes, not just a filename.
// Pin the immutable Hugging Face revision so a future upstream replacement cannot silently change the default model bytes.
export const MODEL = {
  title:'Qwen3 1.7B · Q4_K_M · local default model', downloadSize:'1.11 GB',
  name:'Qwen3-1.7B-Q4_K_M.gguf', bytes:1107409280,
  url:'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/911d36c1889f0de12b3ad91d3deecdea58014295/Qwen3-1.7B-Q4_K_M.gguf',
  sha256:'8f6da508f16926c49196d1bf8faecb47aef679227bc69a1d0bc9081c37b15e99',
};
export const CONTEXT_TOKENS=4096;
export const MAX_MODEL_BYTES=1800*1024*1024;