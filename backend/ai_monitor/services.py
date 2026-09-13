"""AI Monitoring & Guard engine.

Per-response workflow (PRD section 10.1):

1. the application records an interaction (tutor answer, generated quiz);
2. ``enqueue_*`` puts it on the monitor queue after the transaction commits
   (async mode) or evaluates inline (sync mode: tests, backfill);
3. ``evaluate_*`` rebuilds bounded evidence, runs the deterministic
   validators, decides whether the judge is needed, calls it if so, and
   writes one ``Evaluation``;
4. ``apply_policy`` turns the verdict into an ``Incident`` only when the
   configured thresholds are met.

Nothing here raises into the student-facing path: the hooks swallow and log
every failure, and a failed evaluation is stored as ``stage=failed`` so the
coverage metric shows the gap rather than hiding it.
"""
from __future__ import annotations

import hashlib
import logging
import queue
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from academics.models import Subject
from accounts.models import Role, User
from ai.gateway import trim_source
from assessments.models import Assessment
from audit import services as audit
from core.exceptions import NotFound, ValidationFailed
from core.utils import get_or_404
from documents.services import retrieval
from documents.services.chunking import ensure_chunks
from tutor.models import Message

from . import judge, validators
from .models import (ACADEMIC_ISSUE_TYPES, DEFAULT_POLICIES, SEVERITY_RANK, Evaluation, EvaluationStage, Feedback, FeedbackLabel,
                     Incident, IncidentStatus, InteractionKind, IssueType, Policy, RecommendedAction, Severity, Verdict)
from .validators import Check, Evidence

logger = logging.getLogger("localmind.ai_monitor")

# Validator failures at or above this confidence are proven; the judge is
# not consulted for them (structural problems, leaked fields, placeholders).
PROVEN_CONFIDENCE = 0.9
# Recurrence window and count that bump severity by one level (FR-07).
RECURRENCE_DAYS = 7
RECURRENCE_BUMP_AT = 3
EXCERPT_CHARS = 4000


def _cfg(name: str, default=None):
    return settings.AI_MONITOR.get(name, default)


def enabled() -> bool:
    return bool(_cfg("ENABLED", True)) and _cfg("MODE", "async") != "off"


def evaluator_version() -> str:
    return str(_cfg("EVALUATOR_VERSION", "1.0"))


# ---------------------------------------------------------------- policy ----

def ensure_default_policies() -> None:
    for issue_type, (on, conf, sev, desc) in DEFAULT_POLICIES.items():
        Policy.objects.get_or_create(issue_type=issue_type, defaults={"enabled": on, "min_confidence": conf, "min_severity": sev, "description": desc})


def policy_defaults_confidence(issue_type: str) -> float:
    """The default incident threshold for an issue type, without touching the
    database (used by the benchmark, which must not write rows)."""
    return DEFAULT_POLICIES.get(issue_type, DEFAULT_POLICIES[IssueType.OTHER])[1] if issue_type in DEFAULT_POLICIES else 0.0


def policy_for(issue_type: str) -> Policy:
    row = Policy.objects.filter(issue_type=issue_type).first()
    if row is None:
        on, conf, sev, desc = DEFAULT_POLICIES.get(issue_type, DEFAULT_POLICIES[IssueType.OTHER])
        row, _ = Policy.objects.get_or_create(issue_type=issue_type, defaults={"enabled": on, "min_confidence": conf, "min_severity": sev, "description": desc})
    return row


def update_policy(actor, issue_type: str, *, request=None, **fields) -> Policy:
    if issue_type not in IssueType.values or issue_type == IssueType.NONE:
        raise NotFound("Policy not found.")
    row = policy_for(issue_type)
    changes = {}
    if "enabled" in fields:
        row.enabled = bool(fields["enabled"]); changes["enabled"] = row.enabled
    if "min_confidence" in fields:
        try:
            value = float(fields["min_confidence"])
        except (TypeError, ValueError):
            raise ValidationFailed(details={"min_confidence": "Must be a number between 0 and 1."})
        if not 0.0 <= value <= 1.0:
            raise ValidationFailed(details={"min_confidence": "Must be between 0 and 1."})
        row.min_confidence = value; changes["min_confidence"] = value
    if "min_severity" in fields:
        if fields["min_severity"] not in Severity.values:
            raise ValidationFailed(details={"min_severity": f"One of {', '.join(Severity.values)}."})
        row.min_severity = fields["min_severity"]; changes["min_severity"] = row.min_severity
    if "description" in fields:
        row.description = str(fields["description"] or "")[:300]
    row.version += 1
    row.updated_by = actor if getattr(actor, "pk", None) else None
    row.save()
    audit.record(actor, "ai_monitor.policy_updated", row, changes, request)
    return row


# -------------------------------------------------------------- evidence ----

def _passages_from_chunks(chunks) -> list[dict]:
    out = []
    for c in chunks:
        ref = c.heading or f"chunk {c.order + 1}"
        if c.page_start:
            ref += f", p.{c.page_start}" + (f"-{c.page_end}" if c.page_end and c.page_end != c.page_start else "")
        out.append({"kind": "chunk", "ref": ref, "id": str(c.pk), "text": c.text})
    return out


def _bounded(passages: list[dict], limit: int) -> list[dict]:
    """Trim the stored/judged copy of the evidence to the character budget,
    keeping whole passages first and cutting the last one on a sentence."""
    kept, used = [], 0
    for p in passages:
        text = p.get("text", "")
        if used + len(text) > limit:
            room = limit - used
            if room > 300:
                kept.append({**p, "text": trim_source(text, room), "truncated": True})
            break
        kept.append(p)
        used += len(text)
    return kept


def _prompt_for(message: Message) -> str:
    prior = (Message.objects.filter(conversation_id=message.conversation_id, role="user", created_at__lte=message.created_at)
             .exclude(pk=message.pk).order_by("-created_at").first())
    return prior.content if prior else ""


def evidence_for_message(message: Message) -> tuple[str, Evidence]:
    """The student's question and the passages that should have answered it,
    rebuilt the way the tutor built them (BM25 over the module's chunks)."""
    module = message.conversation.module
    prompt = _prompt_for(message)
    hits = retrieval.retrieve(module, prompt or message.content, k=int(_cfg("EVIDENCE_CHUNKS", 4)),
                              max_k=int(_cfg("EVIDENCE_CHUNKS", 4)) + 1, char_budget=int(_cfg("MAX_EVIDENCE_CHARS", 6000)))
    if hits:
        passages = _passages_from_chunks([h.chunk for h in hits])
    elif module.source_text.strip():
        passages = [{"kind": "source_text", "ref": module.title, "text": trim_source(module.source_text, int(_cfg("MAX_EVIDENCE_CHARS", 6000)))}]
    else:
        passages = []
    return prompt, Evidence(passages)


def _assessment_modules(assessment: Assessment):
    if assessment.kind == "selection":
        chosen = list(assessment.source_modules.all().order_by("chapter__order", "order"))
        if chosen:
            return chosen
    if assessment.module_id:
        return [assessment.module]
    if assessment.chapter_id:
        return list(assessment.chapter.modules.all())
    return []


def evidence_for_assessment(assessment: Assessment) -> Evidence:
    """Every chunk of every module the quiz was written from: a quiz is
    checked against the whole source, not a retrieval sample."""
    passages = []
    for module in _assessment_modules(assessment):
        chunks = ensure_chunks(module)
        if chunks:
            passages += _passages_from_chunks(chunks)
        elif module.source_text.strip():
            passages.append({"kind": "source_text", "ref": module.title, "text": module.source_text})
    return Evidence(passages)


# --------------------------------------------------------------- decision ---

def _sampled(interaction_id) -> bool:
    percent = max(0, min(100, int(_cfg("SAMPLE_PERCENT", 10))))
    if percent == 0:
        return False
    digest = int(hashlib.sha256(str(interaction_id).encode()).hexdigest()[:8], 16)
    return digest % 100 < percent


def _top(checks: list[Check]) -> Check | None:
    failing = [c for c in checks if c.passed is False]
    if not failing:
        return None
    return max(failing, key=lambda c: (SEVERITY_RANK.get(c.severity, 0), c.confidence))


def _judge_reason(checks: list[Check], interaction_id, force: bool) -> str:
    if force:
        return "forced"
    top = _top(checks)
    if top is not None:
        return "" if top.confidence >= PROVEN_CONFIDENCE else "suspicious"
    if any(c.passed is None and c.name != "prompt_injection_marker" for c in checks):
        return "undecided"
    return "sampled" if _sampled(interaction_id) else ""


def _action_for(issue_type: str) -> str:
    if issue_type in (IssueType.QUIZ_ERROR, IssueType.INSTRUCTION_VIOLATION):
        return RecommendedAction.CORRECT_CONTENT
    if issue_type == IssueType.NONE:
        return RecommendedAction.NO_ACTION
    return RecommendedAction.REVIEW


def decide(checks: list[Check], judge_data: dict | None, judge_failed: bool) -> dict:
    """Combine validator results with the judge verdict (PRD 8.3).

    * a proven validator failure stands on its own;
    * the judge's issue is taken when it found one, with confidence lifted
      when a validator pointed the same way;
    * a confident judge "no issue" overrides an unproven validator flag;
    * a low-confidence judge answer never confirms anything: the validator
      flag stays as it was, and with nothing else to go on the verdict is
      "abstain", which creates no incident.
    """
    top = _top(checks)
    undecided = any(c.passed is None and c.name != "prompt_injection_marker" for c in checks)
    proven = top is not None and top.confidence >= PROVEN_CONFIDENCE

    min_judge = float(_cfg("MIN_JUDGE_CONFIDENCE", 0.6))
    if judge_data is not None:
        if judge_data["is_issue"] and (judge_data["confidence"] >= min_judge or top is not None):
            # A judge issue counts on its own only at or above the minimum
            # confidence; below it, it can only reinforce a validator finding.
            confidence = judge_data["confidence"]
            severity = judge_data["severity"]
            if top is not None:
                confidence = min(1.0, max(confidence, top.confidence) + 0.05)
                if SEVERITY_RANK[top.severity] > SEVERITY_RANK[severity]:
                    severity = top.severity
            return {"verdict": Verdict.ISSUE, "issue_type": judge_data["issue_type"], "severity": severity, "confidence": round(confidence, 3),
                    "reason": judge_data["reason"], "recommended_action": judge_data["recommended_action"], "source": "judge"}
        if judge_data["is_issue"]:
            # Judge said "issue" without confidence and no validator agrees:
            # record it as undecided rather than as a finding.
            return {"verdict": Verdict.ABSTAIN, "issue_type": IssueType.NONE, "severity": Severity.LOW, "confidence": judge_data["confidence"],
                    "reason": f"Judge suspected {judge_data['issue_type']} but with confidence {judge_data['confidence']:.2f}, below the "
                              f"{min_judge:.2f} minimum; no validator agreed. {judge_data['reason']}".strip(),
                    "recommended_action": RecommendedAction.NO_ACTION, "source": "judge"}
        if proven:
            return _from_check(top, note="The judge saw no issue but the structural failure is proven.")
        if judge_data["confidence"] >= min_judge:
            return {"verdict": Verdict.PASS, "issue_type": IssueType.NONE, "severity": Severity.LOW, "confidence": judge_data["confidence"],
                    "reason": judge_data["reason"] or "Judge found the response consistent with the reference.", "recommended_action": RecommendedAction.NO_ACTION, "source": "judge"}
        if top is not None:
            return _from_check(top, note="Judge could not decide; the validator finding stands at its own confidence.")
        return {"verdict": Verdict.ABSTAIN, "issue_type": IssueType.NONE, "severity": Severity.LOW, "confidence": judge_data["confidence"],
                "reason": "Insufficient evidence to decide either way.", "recommended_action": RecommendedAction.NO_ACTION, "source": "judge"}

    if top is not None:
        return _from_check(top, note="Judge unavailable; validator finding only." if judge_failed else "")
    if undecided and judge_failed:
        return {"verdict": Verdict.ABSTAIN, "issue_type": IssueType.NONE, "severity": Severity.LOW, "confidence": 0.0,
                "reason": "Validators could not decide and the judge was unavailable.", "recommended_action": RecommendedAction.NO_ACTION, "source": "validators"}
    if undecided:
        return {"verdict": Verdict.ABSTAIN, "issue_type": IssueType.NONE, "severity": Severity.LOW, "confidence": 0.0,
                "reason": "No reference material to verify against.", "recommended_action": RecommendedAction.NO_ACTION, "source": "validators"}
    return {"verdict": Verdict.PASS, "issue_type": IssueType.NONE, "severity": Severity.LOW, "confidence": 0.9,
            "reason": "Every deterministic check passed.", "recommended_action": RecommendedAction.NO_ACTION, "source": "validators"}


def _from_check(check: Check, note: str = "") -> dict:
    reason = f"{check.name}: {check.detail}" + (f" {note}" if note else "")
    return {"verdict": Verdict.ISSUE, "issue_type": check.issue_type, "severity": check.severity, "confidence": round(check.confidence, 3),
            "reason": reason, "recommended_action": _action_for(check.issue_type), "source": "validators"}


def _bump(severity: str) -> str:
    order = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL]
    return order[min(len(order) - 1, order.index(severity) + 1)]


def _recurrence(issue_type: str, module_id, exclude_pk=None) -> int:
    if not module_id:
        return 0
    since = timezone.now() - timedelta(days=RECURRENCE_DAYS)
    qs = Incident.objects.filter(issue_type=issue_type, evaluation__module_id=module_id, created_at__gte=since)
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    return qs.count()


def apply_policy(evaluation: Evaluation) -> Incident | None:
    """Create an incident when the policy admits this verdict (FR-09)."""
    if evaluation.verdict != Verdict.ISSUE or evaluation.issue_type == IssueType.NONE:
        return None
    if Incident.objects.filter(evaluation=evaluation).exists():
        return evaluation.incident
    policy = policy_for(evaluation.issue_type)
    severity = evaluation.severity
    recurrence = _recurrence(evaluation.issue_type, evaluation.module_id)
    if recurrence >= RECURRENCE_BUMP_AT:
        severity = _bump(severity)
    if evaluation.issue_type == IssueType.SAFETY and evaluation.confidence >= 0.8:
        severity = Severity.CRITICAL
    if not policy.admits(severity, evaluation.confidence):
        return None
    if severity != evaluation.severity:
        evaluation.severity = severity
        evaluation.save(update_fields=["severity", "updated_at"])
    return Incident.objects.create(evaluation=evaluation, user=evaluation.user, subject=evaluation.subject,
                                   issue_type=evaluation.issue_type, severity=severity, recurrence=recurrence)


# ------------------------------------------------------------- evaluation ---

def _run(*, kind: str, interaction_id, prompt: str, response_text: str, checks: list[Check], evidence: Evidence,
         metadata: dict, links: dict, force_judge: bool) -> Evaluation:
    started = time.monotonic()
    bounded = _bounded(evidence.passages, int(_cfg("MAX_EVIDENCE_CHARS", 6000)))
    evidence_text = "\n\n".join(f"[{p.get('ref', '')}] {p.get('text', '')}" for p in bounded)
    reason = _judge_reason(checks, interaction_id, force_judge)
    judge_data, judge_failed, judge_model, judge_latency, judge_error, judge_raw, invoked = None, False, "", None, "", {}, False
    if reason and _cfg("JUDGE_ENABLED", True) and settings.AI.get("ENABLED", False):
        invoked = True
        lines = [f"{c.name}: {'pass' if c.passed else 'FAIL' if c.passed is False else 'undecided'} - {c.detail}" for c in checks]
        result = judge.run(kind=kind, prompt=prompt, response=response_text, evidence_text=evidence_text, validator_lines=lines, metadata=metadata)
        judge_model, judge_latency = result.model or judge.judge_model_label(), result.latency_ms
        if result.ok:
            judge_data, judge_raw = result.data, result.data
        else:
            judge_failed, judge_error = True, f"{result.error_code}: {result.error}"[:300]
            logger.warning("Monitor judge failed for %s %s: %s", kind, interaction_id, judge_error)
    elif reason:
        judge_failed, judge_error = True, "judge disabled"
    decision = decide(checks, judge_data, judge_failed)

    fields = dict(
        interaction_kind=kind, prompt_excerpt=(prompt or "")[:EXCERPT_CHARS], response_excerpt=(response_text or "")[:EXCERPT_CHARS],
        evidence_json=bounded, validators_json=[c.as_dict() for c in checks],
        judge_invoked=invoked, judge_reason=reason, judge_json=judge_raw,
        judge_model=judge_model if reason else "", judge_latency_ms=judge_latency, judge_error=judge_error,
        verdict=decision["verdict"], issue_type=decision["issue_type"], severity=decision["severity"], confidence=decision["confidence"],
        reason=decision["reason"][:2000], recommended_action=decision["recommended_action"], stage=EvaluationStage.DONE, error="",
        duration_ms=int((time.monotonic() - started) * 1000), **links,
    )
    with transaction.atomic():
        evaluation, _ = Evaluation.objects.update_or_create(
            interaction_kind=kind, interaction_id=interaction_id, evaluator_version=evaluator_version(), defaults=fields)
        # A re-evaluation that now passes retires the old incident's claim.
        if evaluation.verdict != Verdict.ISSUE:
            Incident.objects.filter(evaluation=evaluation, status=IncidentStatus.OPEN).update(status=IncidentStatus.CLOSED, resolved_at=timezone.now(), reviewer_note="Closed automatically: re-evaluation found no issue.")
        incident = apply_policy(evaluation)
    logger.info("Monitor %s %s verdict=%s issue=%s severity=%s confidence=%.2f judge=%s incident=%s",
                kind, interaction_id, evaluation.verdict, evaluation.issue_type, evaluation.severity, evaluation.confidence, reason or "no", bool(incident))
    return evaluation


def _failed(kind: str, interaction_id, exc: Exception, links: dict) -> Evaluation:
    evaluation, _ = Evaluation.objects.update_or_create(
        interaction_kind=kind, interaction_id=interaction_id, evaluator_version=evaluator_version(),
        defaults=dict(stage=EvaluationStage.FAILED, error=str(exc)[:300], verdict=Verdict.ABSTAIN, issue_type=IssueType.NONE, **links))
    return evaluation


def evaluate_message(message: Message, force_judge: bool = False) -> Evaluation:
    if message.role != "assistant":
        raise ValidationFailed("Only assistant messages are evaluated.", code="NOT_AN_AI_RESPONSE")
    conv = message.conversation
    module = conv.module
    subject = module.chapter.document.subject
    links = {"message": message, "user": conv.student, "subject": subject, "module": module, "app_model_name": message.model_name or ""}
    try:
        prompt, evidence = evidence_for_message(message)
        checks = validators.run_tutor_checks(prompt=prompt, response=message.content, source_reference=message.source_reference,
                                             claimed_grounded=bool(message.grounded), evidence=evidence)
        metadata = {"subject": subject.code, "module": module.title, "model": message.model_name, "claimed_grounded": message.grounded,
                    "source_reference": message.source_reference[:200]}
        return _run(kind=InteractionKind.TUTOR_ANSWER, interaction_id=message.pk, prompt=prompt, response_text=message.content,
                    checks=checks, evidence=evidence, metadata=metadata, links=links, force_judge=force_judge)
    except Exception as exc:  # the monitor must never take the tutor down with it
        logger.exception("Monitor failed on message %s", message.pk)
        return _failed(InteractionKind.TUTOR_ANSWER, message.pk, exc, links)


def _quiz_text(assessment: Assessment) -> str:
    lines = [f"TITLE: {assessment.title}"]
    for q in assessment.questions:
        lines.append(f"{q.get('id')}: {q.get('question')}")
        for o in q.get("options") or []:
            lines.append(f"   {o.get('key')}. {o.get('text')}")
        if q.get("type") == "subjective":
            lines.append(f"   rubric: {q.get('expected_rubric')}")
        else:
            lines.append(f"   correct: {q.get('correct_answer')}  explanation: {q.get('explanation')}")
        lines.append(f"   source_reference: {q.get('source_reference')}")
    return "\n".join(lines)


def evaluate_assessment(assessment: Assessment, force_judge: bool = False) -> Evaluation:
    modules = _assessment_modules(assessment)
    links = {"assessment": assessment, "user": assessment.created_by, "subject": assessment.subject,
             "module": modules[0] if len(modules) == 1 else None, "app_model_name": settings.AI.get("TUTOR_MODEL", "") if assessment.generator == "ai" else assessment.generator}
    try:
        evidence = evidence_for_assessment(assessment)
        checks = validators.run_quiz_checks(questions=assessment.questions or [], evidence=evidence)
        metadata = {"subject": assessment.subject.code, "quiz": assessment.title, "generator": assessment.generator,
                    "questions": len(assessment.questions or []), "modules": ", ".join(m.title for m in modules)[:200]}
        evaluation = _run(kind=InteractionKind.QUIZ, interaction_id=assessment.pk, prompt=f"Generate a quiz on: {', '.join(m.title for m in modules)}",
                          response_text=_quiz_text(assessment), checks=checks, evidence=evidence, metadata=metadata, links=links, force_judge=force_judge)
    except Exception as exc:
        logger.exception("Monitor failed on assessment %s", assessment.pk)
        evaluation = _failed(InteractionKind.QUIZ, assessment.pk, exc, links)
    if assessment.auto_generated:
        # Automatic quizzes wait for this check before going live. A check
        # that could not run does not keep them offline for ever.
        try:
            from assessments.services.auto_quiz import after_check
            after_check(assessment, evaluation)
        except Exception:
            logger.exception("Could not publish or hold automatic quiz %s after its check", assessment.pk)
    return evaluation


def evaluate(kind: str, interaction_id, force_judge: bool = False) -> Evaluation:
    if kind == InteractionKind.TUTOR_ANSWER:
        message = get_or_404(Message.objects.select_related("conversation__module__chapter__document__subject", "conversation__student"), pk=interaction_id)
        return evaluate_message(message, force_judge)
    if kind == InteractionKind.QUIZ:
        assessment = get_or_404(Assessment.objects.select_related("subject", "module", "chapter", "created_by"), pk=interaction_id)
        return evaluate_assessment(assessment, force_judge)
    raise ValidationFailed("kind must be tutor_answer or quiz.", code="INVALID_KIND")


# ------------------------------------------------------------------ queue ---

_queue: "queue.Queue[tuple[str, str]]" = queue.Queue()
_worker: threading.Thread | None = None
_lock = threading.Lock()


def _drain():
    global _worker
    while True:
        try:
            kind, interaction_id = _queue.get(timeout=30)
        except queue.Empty:
            with _lock:
                _worker = None
            connection.close()
            return
        try:
            evaluate(kind, interaction_id)
        except Exception:
            logger.exception("Monitor worker failed for %s %s", kind, interaction_id)
        finally:
            _queue.task_done()


def queue_depth() -> int:
    return _queue.qsize()


def enqueue(kind: str, interaction_id) -> bool:
    """Schedule an evaluation. Returns True when something was scheduled or
    run. Never raises: this is called from the request path."""
    if not enabled():
        return False
    try:
        mode = _cfg("MODE", "async")
        if mode == "sync":
            evaluate(kind, interaction_id)
            return True
        _queue.put((kind, str(interaction_id)))
        with _lock:
            global _worker
            if _worker is None or not _worker.is_alive():
                _worker = threading.Thread(target=_drain, name="ai-monitor", daemon=True)
                _worker.start()
        return True
    except Exception:
        logger.exception("Could not enqueue %s %s for monitoring", kind, interaction_id)
        return False


def enqueue_message(message: Message) -> bool:
    if message.role != "assistant":
        return False
    return enqueue(InteractionKind.TUTOR_ANSWER, message.pk)


def enqueue_assessment(assessment: Assessment) -> bool:
    if assessment.generator != "ai":
        return False
    return enqueue(InteractionKind.QUIZ, assessment.pk)


# ----------------------------------------------------------------- review ---

REVIEW_ACTIONS = {
    "confirm": (IncidentStatus.CONFIRMED, FeedbackLabel.CORRECT),
    "false_positive": (IncidentStatus.FALSE_POSITIVE, FeedbackLabel.FALSE_POSITIVE),
    "needs_investigation": (IncidentStatus.NEEDS_INVESTIGATION, FeedbackLabel.NEEDS_INVESTIGATION),
    "escalate": (IncidentStatus.ESCALATED, None),
    "close": (IncidentStatus.CLOSED, None),
    "reopen": (IncidentStatus.OPEN, None),
}
FACULTY_ACTIONS = ("confirm", "false_positive", "needs_investigation")


def incidents_for(user):
    """Admins see everything. Faculty see academic-content incidents in
    subjects they are assigned to (FR-13, privacy-aware views)."""
    qs = Incident.objects.select_related("evaluation", "user", "subject", "assigned_to", "resolved_by")
    if user.role == Role.ADMIN:
        return qs
    if user.role == Role.FACULTY:
        return qs.filter(subject__in=Subject.objects.visible_to(user), issue_type__in=ACADEMIC_ISSUE_TYPES)
    return qs.none()


def evaluations_for(user):
    qs = Evaluation.objects.select_related("user", "subject", "module", "message", "assessment")
    if user.role == Role.ADMIN:
        return qs
    if user.role == Role.FACULTY:
        return qs.filter(subject__in=Subject.objects.visible_to(user))
    return qs.none()


def review_incident(actor, incident: Incident, action: str, *, note: str = "", assigned_to=None, request=None) -> Incident:
    if action not in REVIEW_ACTIONS:
        raise ValidationFailed(f"action must be one of {', '.join(REVIEW_ACTIONS)}.", code="INVALID_ACTION")
    if actor.role == Role.FACULTY and action not in FACULTY_ACTIONS:
        raise ValidationFailed("Faculty may confirm, mark false positive or request investigation.", code="ACTION_NOT_ALLOWED")
    status, label = REVIEW_ACTIONS[action]
    with transaction.atomic():
        incident.status = status
        if note:
            incident.reviewer_note = note[:2000]
        if assigned_to is not None:
            incident.assigned_to = assigned_to
        if incident.is_resolved:
            incident.resolved_by, incident.resolved_at = actor, timezone.now()
        elif action == "reopen":
            incident.resolved_by, incident.resolved_at = None, None
        incident.save()
        if label:
            Feedback.objects.create(evaluation=incident.evaluation, incident=incident, reviewer=actor, label=label, note=note[:2000])
        audit.record(actor, f"ai_monitor.incident_{action}", incident, {"severity": incident.severity, "issue_type": incident.issue_type, "note": bool(note)}, request)
    # A false positive or a closed incident releases an automatic quiz that was
    # held because of it.
    from assessments.services.auto_quiz import release_after_review
    release_after_review(incident)
    return incident


def assign_incident(actor, incident: Incident, assignee_id, request=None) -> Incident:
    assignee = None
    if assignee_id:
        assignee = get_or_404(User.objects.filter(role=Role.ADMIN, status="active"), pk=assignee_id)
    incident.assigned_to = assignee
    incident.save(update_fields=["assigned_to", "updated_at"])
    audit.record(actor, "ai_monitor.incident_assigned", incident, {"assigned_to": assignee.email if assignee else None}, request)
    return incident


def add_feedback(actor, evaluation: Evaluation, label: str, note: str = "", request=None) -> Feedback:
    if label not in FeedbackLabel.values:
        raise ValidationFailed(f"label must be one of {', '.join(FeedbackLabel.values)}.", code="INVALID_LABEL")
    incident = Incident.objects.filter(evaluation=evaluation).first()
    row = Feedback.objects.create(evaluation=evaluation, incident=incident, reviewer=actor, label=label, note=note[:2000])
    audit.record(actor, "ai_monitor.feedback", evaluation, {"label": label}, request)
    return row


# -------------------------------------------------------------- analytics ---

def _window(days: int | None):
    days = max(1, min(365, int(days or 30)))
    return timezone.now() - timedelta(days=days)


def overview(days: int = 30) -> dict:
    since = _window(days)
    interactions = (Message.objects.filter(role="assistant", created_at__gte=since).count()
                    + Assessment.objects.filter(generator="ai", created_at__gte=since).count())
    evals = Evaluation.objects.filter(created_at__gte=since)
    done = evals.filter(stage=EvaluationStage.DONE)
    incidents = Incident.objects.filter(created_at__gte=since)
    feedback = Feedback.objects.filter(created_at__gte=since)
    labelled = feedback.count()
    fp = feedback.filter(label=FeedbackLabel.FALSE_POSITIVE).count()
    high = incidents.filter(severity__in=(Severity.HIGH, Severity.CRITICAL))
    high_reviewed = high.filter(status__in=(IncidentStatus.CONFIRMED, IncidentStatus.FALSE_POSITIVE))
    high_confirmed = high.filter(status=IncidentStatus.CONFIRMED).count()
    return {
        "window_days": days,
        "interactions": interactions,
        "evaluated": done.count(),
        "failed_evaluations": evals.filter(stage=EvaluationStage.FAILED).count(),
        "coverage_percent": round(100.0 * done.count() / interactions, 1) if interactions else None,
        "judge_invocations": done.filter(judge_invoked=True).count(),
        "verdicts": {v: done.filter(verdict=v).count() for v in Verdict.values},
        "incidents": incidents.count(),
        "open_incidents": Incident.objects.filter(status__in=(IncidentStatus.OPEN, IncidentStatus.ESCALATED, IncidentStatus.NEEDS_INVESTIGATION)).count(),
        "high_severity_incidents": high.count(),
        "by_severity": {s: incidents.filter(severity=s).count() for s in Severity.values},
        "by_issue_type": {t: incidents.filter(issue_type=t).count() for t in IssueType.values if t != IssueType.NONE},
        "by_status": {s: incidents.filter(status=s).count() for s in IncidentStatus.values},
        "false_positive_rate_percent": round(100.0 * fp / labelled, 1) if labelled else None,
        "high_severity_precision_percent": round(100.0 * high_confirmed / high_reviewed.count(), 1) if high_reviewed.exists() else None,
        "feedback_count": labelled,
        "queue_depth": queue_depth(),
        "evaluator_version": evaluator_version(),
    }


def trends(days: int = 30) -> dict:
    since = _window(days)
    rows = (Incident.objects.filter(created_at__gte=since).annotate(day=TruncDate("created_at"))
            .values("day", "severity", "issue_type").annotate(count=Count("id")).order_by("day"))
    by_day: dict[str, dict] = {}
    for r in rows:
        key = r["day"].isoformat()
        bucket = by_day.setdefault(key, {"day": key, "total": 0, "by_severity": {s: 0 for s in Severity.values}, "by_issue_type": {}})
        bucket["total"] += r["count"]
        bucket["by_severity"][r["severity"]] += r["count"]
        bucket["by_issue_type"][r["issue_type"]] = bucket["by_issue_type"].get(r["issue_type"], 0) + r["count"]
    evals = (Evaluation.objects.filter(created_at__gte=since, stage=EvaluationStage.DONE).annotate(day=TruncDate("created_at"))
             .values("day").annotate(count=Count("id"), issues=Count("id", filter=Q(verdict=Verdict.ISSUE))).order_by("day"))
    for r in evals:
        key = r["day"].isoformat()
        bucket = by_day.setdefault(key, {"day": key, "total": 0, "by_severity": {s: 0 for s in Severity.values}, "by_issue_type": {}})
        bucket["evaluated"] = r["count"]
        bucket["issues"] = r["issues"]
    return {"window_days": days, "days": sorted(by_day.values(), key=lambda b: b["day"])}


def model_health(days: int = 30) -> list[dict]:
    since = _window(days)
    rows = (Evaluation.objects.filter(created_at__gte=since, stage=EvaluationStage.DONE).values("app_model_name")
            .annotate(evaluated=Count("id"), issues=Count("id", filter=Q(verdict=Verdict.ISSUE)),
                      incidents=Count("incident", filter=Q(incident__isnull=False)),
                      high=Count("incident", filter=Q(incident__severity__in=(Severity.HIGH, Severity.CRITICAL)))).order_by("-evaluated"))
    return [{"model": r["app_model_name"] or "(unknown)", "evaluated": r["evaluated"], "issues": r["issues"],
             "issue_rate_percent": round(100.0 * r["issues"] / r["evaluated"], 1) if r["evaluated"] else 0.0,
             "incidents": r["incidents"], "high_severity": r["high"]} for r in rows]


def subject_health(user, days: int = 30) -> list[dict]:
    since = _window(days)
    subjects = Subject.objects.visible_to(user)
    rows = (Evaluation.objects.filter(created_at__gte=since, stage=EvaluationStage.DONE, subject__in=subjects)
            .values("subject_id", "subject__code", "subject__name")
            .annotate(evaluated=Count("id"), issues=Count("id", filter=Q(verdict=Verdict.ISSUE)), incidents=Count("incident", filter=Q(incident__isnull=False)))
            .order_by("-incidents", "subject__code"))
    out = []
    for r in rows:
        top = (Incident.objects.filter(subject_id=r["subject_id"], created_at__gte=since).values("issue_type")
               .annotate(count=Count("id")).order_by("-count")[:3])
        out.append({"subject_id": str(r["subject_id"]), "code": r["subject__code"], "name": r["subject__name"], "evaluated": r["evaluated"],
                    "issues": r["issues"], "incidents": r["incidents"],
                    "incident_rate_percent": round(100.0 * r["incidents"] / r["evaluated"], 1) if r["evaluated"] else 0.0,
                    "common_failures": [{"issue_type": t["issue_type"], "count": t["count"]} for t in top]})
    return out


def user_impact(user, days: int = 30) -> list[dict]:
    """Who was affected, without exposing what was said (FR-13)."""
    since = _window(days)
    rows = (incidents_for(user).filter(created_at__gte=since, user__isnull=False)
            .values("user_id", "user__email", "user__full_name", "user__role")
            .annotate(incidents=Count("id"), high=Count("id", filter=Q(severity__in=(Severity.HIGH, Severity.CRITICAL))),
                      open=Count("id", filter=Q(status__in=(IncidentStatus.OPEN, IncidentStatus.ESCALATED, IncidentStatus.NEEDS_INVESTIGATION))))
            .order_by("-high", "-incidents"))
    return [{"user_id": str(r["user_id"]), "email": r["user__email"], "full_name": r["user__full_name"], "role": r["user__role"],
             "incidents": r["incidents"], "high_severity": r["high"], "open": r["open"]} for r in rows]


def status() -> dict:
    ok, detail = judge.judge_available()
    return {"enabled": enabled(), "mode": _cfg("MODE", "async"), "judge_enabled": bool(_cfg("JUDGE_ENABLED", True)),
            "judge_ready": ok, "judge_detail": detail, "judge_model": judge.judge_model_label(), "sample_percent": int(_cfg("SAMPLE_PERCENT", 10)),
            "evaluator_version": evaluator_version(), "queue_depth": queue_depth(), "retention_days": int(_cfg("RETENTION_DAYS", 180)),
            "pending_backlog": backlog_count()}


def backlog_count() -> int:
    """Interactions with no evaluation at the current evaluator version."""
    version = evaluator_version()
    done_msgs = Evaluation.objects.filter(interaction_kind=InteractionKind.TUTOR_ANSWER, evaluator_version=version).values("interaction_id")
    done_quiz = Evaluation.objects.filter(interaction_kind=InteractionKind.QUIZ, evaluator_version=version).values("interaction_id")
    return (Message.objects.filter(role="assistant").exclude(pk__in=done_msgs).count()
            + Assessment.objects.filter(generator="ai").exclude(pk__in=done_quiz).count())


def backlog(kind: str | None = None, since=None, limit: int | None = None):
    """(kind, id) pairs awaiting evaluation, oldest first."""
    version = evaluator_version()
    pairs = []
    if kind in (None, InteractionKind.TUTOR_ANSWER):
        done = Evaluation.objects.filter(interaction_kind=InteractionKind.TUTOR_ANSWER, evaluator_version=version).values("interaction_id")
        qs = Message.objects.filter(role="assistant").exclude(pk__in=done).order_by("created_at")
        if since:
            qs = qs.filter(created_at__gte=since)
        pairs += [(InteractionKind.TUTOR_ANSWER, pk) for pk in qs.values_list("pk", flat=True)]
    if kind in (None, InteractionKind.QUIZ):
        done = Evaluation.objects.filter(interaction_kind=InteractionKind.QUIZ, evaluator_version=version).values("interaction_id")
        qs = Assessment.objects.filter(generator="ai").exclude(pk__in=done).order_by("created_at")
        if since:
            qs = qs.filter(created_at__gte=since)
        pairs += [(InteractionKind.QUIZ, pk) for pk in qs.values_list("pk", flat=True)]
    return pairs[:limit] if limit else pairs


def purge(retention_days: int | None = None) -> tuple[int, int]:
    """Delete evaluations past retention (their incidents cascade) unless the
    incident is still open. Returns (evaluations deleted, incidents deleted)."""
    days = int(retention_days or _cfg("RETENTION_DAYS", 180))
    cutoff = timezone.now() - timedelta(days=days)
    live = (IncidentStatus.OPEN, IncidentStatus.ESCALATED, IncidentStatus.NEEDS_INVESTIGATION)
    qs = Evaluation.objects.filter(created_at__lt=cutoff).exclude(incident__status__in=live)
    incidents = Incident.objects.filter(evaluation__in=qs).count()
    deleted, _ = qs.delete()
    return deleted, incidents