"""A stand-in for Ollama that speaks just enough of its API for LocalMind.

    python scripts/fake_ollama.py [port]        # default 11434

Implements GET /api/tags, POST /api/pull and POST /api/chat. Chat replies are
built from the JSON schema in the request's ``format`` field, so every reply
validates, and a few prompt-aware rules produce content the application's
post-validators accept (distinct quiz options, outline indices that exist,
rubric points that sum to the requested total). Use it to run the client or
``scripts/system_test.py`` on a machine without a GPU or the real model. Not a
model: the text is generic and carries no meaning.
"""
from __future__ import annotations

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MODELS = ["qwen3:1.7b"]
# delay_ms slows every chat reply, to exercise queueing and priority.
_state = {"calls": 0, "fail_next": 0, "offline": 0, "delay_ms": 0}


def _instance(schema: dict, hint: str, path: str = "") -> object:
    kind = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if kind == "object":
        return {key: _instance(sub, hint, f"{path}.{key}") for key, sub in schema.get("properties", {}).items()}
    if kind == "array":
        n = schema.get("minItems", 2) or 2
        n = min(n, schema.get("maxItems", n))
        items = schema.get("items", {"type": "string"})
        out = [_instance(items, hint, f"{path}[{i}]") for i in range(n)]
        # Quiz options: A-D keys with distinct text.
        if path.endswith(".options") and items.get("type") == "object":
            for i, key in enumerate("ABCD"[:n]):
                out[i]["key"] = key
                out[i]["text"] = f"Option {key} drawn from the source"
        return out
    if kind == "integer":
        return 1
    if kind == "number":
        return 1.0
    if kind == "boolean":
        return True
    # e.g. ".mcq_questions[2].question" -> "mcq_questions 2 question"
    label = " ".join(re.findall(r"[a-z_]+|\d+", path)) or "value"
    return f"{label} ({hint}) from the source text"


def _outline_from_prompt(prompt: str) -> dict | None:
    heads = re.findall(r"^\[(\d+)\] level (\d+): (.+)$", prompt, re.MULTILINE)
    if not heads:
        return None
    heads = [(int(i), int(lvl), t.strip()) for i, lvl, t in heads]
    top = min(l for _, l, _ in heads)
    chapters, current = [], None
    for idx, lvl, title in heads:
        if lvl == top:
            current = {"title": title, "source_heading_index": idx, "modules": []}
            chapters.append(current)
        elif current is not None:
            current["modules"].append({"title": title, "source_heading_index": idx})
    return {"document_title": "Generated outline", "chapters": chapters}


def _quiz_reply(schema: dict, prompt: str) -> dict:
    """Questions shaped like a real model's: readable wording about the TOPIC,
    four distinct plain options and a quote copied from the section, so the
    application's wording and grounding checks accept them."""
    topic = (re.search(r"^TOPIC: (.+)$", prompt, re.MULTILINE) or [None, "this topic"])[1].strip()
    section = re.search(r'TEXTBOOK SECTION:\n"""(.*?)"""', prompt, re.DOTALL)
    words = (section.group(1) if section else topic).split()
    quote = " ".join(words[:8])
    props = schema.get("properties", {})
    tag = _state["calls"]
    out = {}
    if "mcq_questions" in props:
        n = props["mcq_questions"].get("minItems", 1)
        out["mcq_questions"] = [{
            "question": f"Which statement about {topic} is correct (set {tag}, item {i + 1})?",
            "options": [f"{topic}: statement {k} of set {tag}.{i + 1}" for k in "ABCD"],
            "answer": "A", "explanation": f"The first statement describes {topic} correctly.", "quote": quote,
        } for i in range(n)]
    if "subjective_questions" in props:
        n = props["subjective_questions"].get("minItems", 1)
        out["subjective_questions"] = [{
            "question": f"Explain the main idea of {topic} in your own words (set {tag}, item {i + 1}).",
            "rubric": "Names the main idea; gives one supporting detail.", "quote": quote,
        } for i in range(n)]
    return out


def reply_for(body: dict) -> dict:
    schema = body.get("format") or {}
    prompt = "\n".join(m.get("content", "") for m in body.get("messages", []))
    _state["calls"] += 0
    if {"mcq_questions", "subjective_questions"} & set(schema.get("properties", {})):
        return _quiz_reply(schema, prompt)
    data = _instance(schema, f"{body.get('model', '')} #{_state['calls']}")
    if "chapters" in schema.get("properties", {}):
        outline = _outline_from_prompt(prompt)
        if outline:
            data = outline
    if "rubric" in schema.get("properties", {}):
        m = re.search(r"TOTAL POINTS: (\d+)", prompt)
        total = int(m.group(1)) if m else 100
        data["rubric"] = [{"criterion": "Accuracy against the source", "points": total // 2},
                          {"criterion": "Clarity and structure", "points": total - total // 2}]
    if "is_correct" in schema.get("properties", {}):
        data.update({"is_correct": "correct" in prompt.lower(), "score_awarded": 1, "missing_points": []})
    if "grounded" in schema.get("properties", {}):
        data["grounded"] = "not in the source" not in prompt.lower()
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def _json(self, status: int, payload: dict):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if _state["offline"] and self.path != "/_state":
            return self._json(503, {"error": "offline"})
        if self.path == "/api/tags":
            return self._json(200, {"models": [{"name": m} for m in MODELS]})
        if self.path == "/_state":
            return self._json(200, _state)
        self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/_control":
            _state.update({k: int(v) for k, v in body.items() if k in _state})
            return self._json(200, _state)
        if _state["offline"]:
            return self._json(503, {"error": "offline"})
        if self.path == "/api/pull":
            if body.get("model") not in MODELS:
                MODELS.append(body["model"])
            return self._json(200, {"status": "success"})
        if self.path != "/api/chat":
            return self._json(404, {"error": "not found"})
        _state["calls"] += 1
        if _state["delay_ms"]:
            import time
            time.sleep(_state["delay_ms"] / 1000)
        if body.get("model") not in MODELS:
            return self._json(404, {"error": f"model '{body.get('model')}' not found"})
        if _state["fail_next"] > 0:
            _state["fail_next"] -= 1
            return self._json(200, {"message": {"role": "assistant", "content": "this is not json"}, "done_reason": "stop"})
        content = json.dumps(reply_for(body))
        self._json(200, {"model": body.get("model"), "message": {"role": "assistant", "content": content}, "done": True, "done_reason": "stop"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11434
    print(f"fake ollama on http://127.0.0.1:{port} serving {MODELS}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
