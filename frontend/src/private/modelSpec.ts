// Publisher file pointer verified 2026-09-17. Verify the bytes, not just a filename.
// https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/raw/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf
export const MODEL = {
  title:'Qwen3 1.7B · Q4_K_M · local model', downloadSize:'1.11 GB',
  name:'Qwen3-1.7B-Q4_K_M.gguf', bytes:1107409472,
  url:'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf',
  sha256:'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
  // MD5 of the same verified file (checked against the SHA-256 above on 2026-09-26).
  // Android computes MD5 natively in seconds; SHA-256 in JavaScript took minutes on phones.
  md5:'dc4836c71a28a136d2a5b782b8465b6f',
};
export const CONTEXT_TOKENS=4096;
export const MAX_MODEL_BYTES=1800*1024*1024;
