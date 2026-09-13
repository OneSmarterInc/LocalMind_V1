import json, uuid
from django.utils import timezone
from accounts.models import User
from academics.models import Subject
from learning.models import Module
from assessments.models import Assessment
from ai_monitor.models import Evaluation, Incident
sub = Subject.objects.get(code="OS101")
m1 = Module.objects.filter(chapter__document__subject=sub).order_by("chapter__order", "order").first()
s1 = User.objects.get(email="student1@localmind.test")
# an automatic quiz held for review
auto = Assessment.objects.filter(subject=sub).exclude(title="Held results check").first()
q = Assessment.objects.create(subject=sub, module=m1, chapter=m1.chapter, kind="module", title="Automatic quiz held for review", status="draft",
    auto_generated=True, held_for_review=True, hold_reason="the AI checker thinks question 1 may not match the module",
    questions=[{"id": "q1", "type": "mcq", "question": "What does the scheduler pick?", "options": [{"key": k, "text": t} for k, t in zip("ABCD", ["The next process", "A file", "A page", "A socket"])], "correct_answer": "A", "explanation": "e"}])
ev = Evaluation.objects.create(interaction_kind="quiz", interaction_id=q.id, assessment=q, user=None, subject=sub, module=m1, app_model_name="qwen3:1.7b",
    prompt_excerpt="Write 1 question from Processes and Scheduling", response_excerpt="Q1: What does the scheduler pick? A) The next process",
    evidence_json=[{"kind": "module", "ref": "Processes and Scheduling", "text": "A process is a program in execution. The scheduler decides which ready process runs next."}],
    validators_json=[{"name": "grounding_overlap", "passed": False, "issue_type": "unsupported_claim", "severity": "high", "confidence": 0.8, "detail": "Low overlap with the module text.", "evidence": []},
                     {"name": "option_count", "passed": True, "issue_type": "none", "severity": "low", "confidence": 1.0, "detail": "Four options.", "evidence": []}],
    verdict="issue", issue_type="unsupported_claim", severity="high", confidence=0.8, reason="The answer may not be supported by the module.", recommended_action="hold", stage="done", evaluator_version="1.0")
inc = Incident.objects.create(evaluation=ev, user=s1, subject=sub, issue_type="unsupported_claim", severity="high", status="open")
print(json.dumps({"held_auto_quiz": str(q.id), "incident": str(inc.id)}))
