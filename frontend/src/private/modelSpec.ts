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
export type ModelSpec={id:string;title:string;downloadSize:string;name:string;bytes:number;url:string;sha256:string;md5:string;summary:string};
// Size and both digests measured from the published file on 2026-09-26. The
// checksum is the pin: if the publisher replaces the file, the download is
// rejected rather than installing different bytes.
export const FAST_MODEL:ModelSpec={
  id:'fast',title:'Qwen3 0.6B · Q4_K_M · fast phone model',downloadSize:'397 MB',
  name:'Qwen3-0.6B-Q4_K_M.gguf',bytes:396705472,
  url:'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
  sha256:'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
  md5:'45349ac9dec6a388775cbd720be5f8df',
  summary:'Fast on any recent phone. Simpler lessons and questions.',
};
/** Models the phone app offers. The website keeps MODEL. */
export const PHONE_MODELS:ModelSpec[]=[FAST_MODEL,{...MODEL,id:'quality',summary:'Better lessons and questions. Best on phones with 8 GB of memory or more; slower on mid-range phones.'}];
/** Phones sold as 8 GB report roughly 7.3 to 7.6 GB as MemTotal. */
export const QUALITY_MODEL_MEMORY=7*1024**3;
export const CONTEXT_TOKENS=4096;
export const MAX_MODEL_BYTES=1800*1024*1024;
