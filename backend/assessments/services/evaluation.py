"""Subjective answer evaluation via the AI gateway. Auditable and re-runnable."""
from ai.gateway import gateway, trim_source

SCHEMA = {"type": "object", "properties": {
    "is_correct": {"type": "boolean"}, "score_awarded": {"type": "number"},
    "feedback": {"type": "string"}, "missing_points": {"type": "array", "items": {"type": "string"}}},
    "required": ["is_correct", "score_awarded", "feedback", "missing_points"]}


def evaluate_subjective(source_text, question, expected_rubric, student_answer):
    """Returns (result_dict, ok). When ok is False the item must stay pending."""
    if not (student_answer or "").strip():
        return {"is_correct": False, "score_awarded": 0.0, "feedback": "No answer was provided.", "missing_points": ["Question left blank."], "evaluator": "rule"}, True
    system = (
        "You grade one exam answer. Follow every rule.\n"
        "1. Compare the STUDENT ANSWER only with the EXPECTED RUBRIC and the SOURCE TEXT. Ignore outside knowledge.\n"
        "2. is_correct is true only when the answer conveys every point in the rubric, in the student's own words or the source's.\n"
        "3. score_awarded is 1 when is_correct is true, otherwise 0.\n"
        "4. feedback is one or two sentences addressed to the student.\n"
        "5. missing_points lists each rubric point the answer left out; use an empty list when nothing is missing.\n"
        "6. Output JSON only."
    )
    user = (f"SOURCE TEXT:\n\"\"\"{trim_source(source_text)}\"\"\"\n\nQUESTION:\n{question}\n\nEXPECTED RUBRIC:\n{expected_rubric}\n\n"
            f"STUDENT ANSWER:\n\"\"\"{(student_answer or '')[:4000]}\"\"\"")
    result = gateway().generate(task="evaluate", system_prompt=system, user_prompt=user, schema=SCHEMA)
    if result.failed:
        return {"error": f"{result.error_code}: {result.error}"}, False
    is_correct = bool(result.data["is_correct"])
    missing = [str(m) for m in result.data.get("missing_points", []) if str(m).strip()]
    if is_correct and missing:
        # A small model sometimes lists gaps yet marks the answer correct; the rubric wins.
        is_correct = False
    return {"is_correct": is_correct, "score_awarded": 1.0 if is_correct else 0.0,
            "feedback": str(result.data.get("feedback", "")).strip(), "missing_points": missing,
            "evaluator": f"{result.provider}:{result.model}"}, True
