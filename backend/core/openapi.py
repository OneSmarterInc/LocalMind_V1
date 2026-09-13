"""drf-spectacular post-processing: derive stable, unique operationIds from
the full path so sibling routes (with and without a trailing id segment) do
not collide, and add error-envelope documentation to every operation."""
import re

ERROR_ENVELOPE = {
    "type": "object",
    "properties": {"error": {"type": "object", "properties": {
        "code": {"type": "string"}, "message": {"type": "string"}, "details": {"type": "object"}},
        "required": ["code", "message"]}},
    "required": ["error"],
}


def unique_operation_ids(result, generator, request, public):
    for path, methods in result.get("paths", {}).items():
        slug = re.sub(r"[{}]", "", path.strip("/").replace("api/", "", 1)).replace("/", "_").replace("-", "_")
        for method, op in methods.items():
            if not isinstance(op, dict):
                continue
            op["operationId"] = f"{method}_{slug}"
            op.setdefault("responses", {})
            for status, desc in (("400", "Validation error"), ("401", "Authentication required"), ("403", "Forbidden"), ("404", "Not found")):
                op["responses"].setdefault(status, {"description": desc, "content": {"application/json": {"schema": ERROR_ENVELOPE}}})
    return result
