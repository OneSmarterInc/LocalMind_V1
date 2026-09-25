"""Portable experimental content contract; has no Django dependency.

The wire payload is signed as exact UTF-8 bytes. Neither verifier re-serializes it.
Final phone resource limits remain contingent on the device experiment.
"""
import base64
import hashlib
import io
import json
import re
import uuid

FORMAT = "localmind-study.experimental.v1"
MOVES = ("reteach", "simplify", "worked_example", "diagnostic", "prerequisite")
STATES = ("question", "definition_miss", "procedure_miss", "repeated_clarification", "not_in_source")
OUTCOMES = ("retry_succeeded", "retry_needed", "clarified_again", "left_module", "not_in_source")
KINDS = ("prose", "table", "figure", "worked_example", "callout")
MAX_BLOCK_CHARS = 3500
MAX_PACKAGE_BYTES = 20 * 1024 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identifier(value):
    require(isinstance(value, str), "Expected a UUID string")
    require(str(uuid.UUID(value)) == value, "Expected a canonical UUID")
    return value


def short_text(value, limit, name, optional=False):
    require(isinstance(value, str) and len(value) <= limit and (optional or bool(value.strip())), f"Invalid {name}")
    return value


def policy(value):
    require(isinstance(value, dict) and set(value) == set(STATES), "Policy must specify only the five known states")
    for order in value.values():
        require(isinstance(order, list) and len(order) == len(MOVES) and set(order) == set(MOVES),
                "Each policy row must order the five teaching moves exactly once")
    return value


def default_policy():
    p = {state: list(MOVES) for state in STATES}
    p["definition_miss"] = ["simplify", "reteach", "diagnostic", "worked_example", "prerequisite"]
    p["procedure_miss"] = ["worked_example", "diagnostic", "reteach", "simplify", "prerequisite"]
    p["repeated_clarification"] = ["diagnostic", "prerequisite", "simplify", "worked_example", "reteach"]
    return p


def validate_question(body):
    require(isinstance(body, dict), "Question must be an object")
    short_text(body.get("prompt"), 800, "question")
    short_text(body.get("explanation", ""), 1000, "explanation", optional=True)
    short_text(body.get("quote"), 500, "supporting source quote")
    kind = body.get("type")
    if kind == "mcq":
        require(set(body) <= {"type", "prompt", "options", "answer", "explanation", "quote"}, "Unexpected question fields")
        options = body.get("options")
        require(isinstance(options, list) and len(options) == 4, "An MCQ needs four options")
        for item in options: short_text(item, 500, "option")
        require(len({o.strip().casefold() for o in options}) == 4, "Options must be distinct")
        require(type(body.get("answer")) is int and 0 <= body["answer"] < 4, "Answer must be an option index")
    elif kind == "short":
        require(set(body) <= {"type", "prompt", "rubric", "explanation", "quote"}, "Unexpected question fields")
        rubric = body.get("rubric")
        require(isinstance(rubric, list) and 1 <= len(rubric) <= 6, "A short answer needs 1-6 rubric points")
        for point in rubric: short_text(point, 250, "rubric point")
    else:
        raise ValueError("Use mcq or short")
    return body


def split_text(text, limit=MAX_BLOCK_CHARS):
    """Bound prose without dropping characters; author reviews the imported blocks."""
    text = text.strip()
    result = []
    while len(text) > limit:
        cut = max(text.rfind("\n", 0, limit), text.rfind(". ", 0, limit), text.rfind(" ", 0, limit))
        if cut < limit // 2: cut = limit
        elif text[cut:cut + 2] == ". ": cut += 1
        result.append(text[:cut].strip()); text = text[cut:].strip()
    if text: result.append(text)
    return result


def blocks_from_markdown(text, title):
    """Preserve tables as typed data and source text; never use an LLM to re-author."""
    out = []
    for part in re.split(r"\n\s*\n", text.strip()):
        if not part.strip(): continue
        lines = part.strip().splitlines()
        if len(lines) >= 2 and all(line.strip().startswith("|") for line in lines):
            require(len(part) <= MAX_BLOCK_CHARS, "This table is too large for a bounded block; split it with faculty review")
            rows = [[cell.strip().replace("&#124;", "|") for cell in line.strip().strip("|").split("|")]
                    for line in lines if not re.match(r"^\s*\|?[\s:|\-]+$", line)]
            require(bool(rows) and all(len(r) == len(rows[0]) for r in rows), "Table rows must have consistent columns")
            out.append({"kind": "table", "title": title, "text": part.strip(), "data": {"rows": rows}})
        else:
            for chunk in split_text(part):
                out.append({"kind": "prose", "title": title, "text": chunk, "data": {}})
    return out


def png_bytes(raw):
    """Decode and re-encode a bounded PNG/JPEG, discarding metadata and active formats."""
    from PIL import Image
    require(len(raw) <= 8 * 1024 * 1024, "Image exceeds 8 MB")
    try:
        opened = Image.open(io.BytesIO(raw))
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("The file is not a supported, bounded PNG/JPEG image") from exc
    with opened as im:
        require(im.format in ("PNG", "JPEG"), "Only PNG and JPEG figures are supported")
        require(im.width <= 4096 and im.height <= 4096, "Figure dimensions exceed 4096 pixels")
        im.load()
        clean = im.convert("RGBA")
        out = io.BytesIO(); clean.save(out, format="PNG")
    require(len(out.getvalue()) <= 2 * 1024 * 1024, "Normalized figure exceeds 2 MB")
    return out.getvalue()


def sign_payload(payload, private_key, key_id):
    short_text(key_id, 80, "publisher key id")
    raw = canonical(payload).encode("utf-8")
    require(len(raw) <= MAX_PACKAGE_BYTES, "Package exceeds the experimental size limit")
    return {"key_id": key_id, "payload": raw.decode(), "signature": base64.b64encode(private_key.sign(raw)).decode()}


def verify_envelope(envelope, trusted_keys):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    require(isinstance(envelope, dict) and set(envelope) == {"key_id", "payload", "signature"}, "Invalid package envelope")
    require(envelope["key_id"] in trusted_keys, "Publisher key is not trusted")
    raw = envelope["payload"].encode("utf-8")
    require(len(raw) <= MAX_PACKAGE_BYTES, "Package is too large")
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(trusted_keys[envelope["key_id"]], validate=True))
    key.verify(base64.b64decode(envelope["signature"], validate=True), raw)
    value = json.loads(raw)
    require(value.get("format") == FORMAT, "Unsupported package format")
    return value
