"""Short inference references; persisted citations retain exact source text."""
import copy
import re


def prepare(source, schema):
    quotes = {}
    spans = []
    for match in re.finditer(r"[^.!?\n]+[.!?]?", source):
        start, end = match.span()
        while start < end:
            while start < end and source[start].isspace():
                start += 1
            stop = min(start + 240, end)
            if stop < end:
                boundary = source.rfind(" ", start, stop)
                if boundary > start:
                    stop = boundary
            quote = source[start:stop].strip()
            if len(quote) >= 8:
                key = f"Q{len(quotes) + 1}"
                quotes[key] = quote
                spans.append((start, key))
            start = stop
    if not quotes:
        return source, schema, lambda value: value
    wire = copy.deepcopy(schema)

    def walk(node):
        if isinstance(node, dict):
            for key, value in list(node.items()):
                if key in {"quote", "source_reference"}:
                    node[key] = {"type": "string", "enum": list(quotes)}
                else:
                    walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(wire)
    for start, key in reversed(spans):
        source = source[:start] + f"[{key}] " + source[start:]

    def restore(node):
        if isinstance(node, list):
            return [restore(value) for value in node]
        if isinstance(node, dict):
            return {key: quotes.get(value, value) if key in {"quote", "source_reference"} and isinstance(value, str)
                    else restore(value) for key, value in node.items()}
        return node

    return source, wire, restore
