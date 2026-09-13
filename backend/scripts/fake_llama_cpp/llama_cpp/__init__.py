"""A stand-in for the ``llama_cpp`` package so the offline path (embedded
provider, model-file validation, health, every portal) can be exercised on a
machine without the native library or a real model.

    PYTHONPATH=scripts/fake_llama_cpp AI_PROVIDER=llamacpp AI_MODEL_PATH=/tmp/fake.gguf python manage.py runserver

Create the placeholder file with ``python scripts/fake_llama_cpp/make_model.py``
(a GGUF header padded to 64 MB, enough to pass validation). Replies are built
from the JSON schema exactly as scripts/fake_ollama.py does, so every reply
validates and the application's post-validators accept it. Not a model: the
text carries no meaning.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # scripts/
from fake_ollama import reply_for  # noqa: E402

_state = {"calls": 0, "fail_next": int(os.environ.get("FAKE_LLAMA_FAIL_NEXT", "0"))}


class Llama:
    def __init__(self, model_path, n_ctx=4096, n_threads=1, n_gpu_layers=0, verbose=False, **kwargs):
        if not Path(model_path).exists():
            raise ValueError(f"Model path does not exist: {model_path}")
        self.model_path = model_path
        self.n_ctx_value = n_ctx

    def create_chat_completion(self, messages, response_format=None, temperature=0.0, max_tokens=None, **kwargs):
        _state["calls"] += 1
        delay_ms = int(os.environ.get("FAKE_LLAMA_DELAY_MS", "0"))
        if delay_ms:
            # Stand in for a slow CPU generation, to exercise queueing and priority.
            import time
            time.sleep(delay_ms / 1000)
        schema = (response_format or {}).get("schema") or {}
        if _state["fail_next"] > 0:
            _state["fail_next"] -= 1
            content = "this is not json"
        else:
            content = json.dumps(reply_for({"format": schema, "messages": messages, "model": "fake-llama"}))
        return {"choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}]}
