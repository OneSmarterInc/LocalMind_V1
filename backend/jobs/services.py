"""One process/one worker is the recommended local deployment.

At-least-once work with conditional claims, heartbeat leases and fenced commits.
No database transaction is held around parsing or model calls. Durable enqueuing
must be in the transaction that stores the user's action, not an on_commit callback.
"""
import hashlib
import json
import logging
import threading
import time
import uuid
from datetime import timedelta
from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import Q, F
from django.utils import timezone
from .models import Job

logger = logging.getLogger("localmind.jobs")
KINDS = {"document_parse", "assessment_grade", "study_bank", "study_figures", "study_policy"}

class LeaseLost(Exception):
    pass


def enabled():
    return bool(getattr(settings, "DURABLE_JOBS", False))


def enqueue(kind, target, payload, *, unique=None, max_attempts=3):
    if kind not in KINDS: raise ValueError("Unknown job kind")
    key = hashlib.sha256(str(unique).encode()).hexdigest() if unique else hashlib.sha256(json.dumps([kind, target, payload], sort_keys=True, default=str).encode()).hexdigest()
    with transaction.atomic():
        row, created = Job.objects.get_or_create(dedupe_key=key, defaults={"kind": kind, "target": target,
            "payload": payload, "max_attempts": max_attempts})
        if not created and row.status in ("failed", "done") and unique is None:
            row.status = "pending"; row.attempts = 0; row.error = ""; row.result = {}; row.available_at = timezone.now()
            row.lease_token = None; row.lease_until = None; row.finished_at = None; row.save()
    return row


def _eligible(now):
    return Q(status__in=("pending", "retry"), available_at__lte=now) | Q(status="running", lease_until__lt=now)


def claim():
    now = timezone.now()
    # A worker that crashed on its final attempt becomes explicitly failed,
    # not a permanently running row and not an infinite retry.
    Job.objects.filter(status="running", lease_until__lt=now, attempts__gte=F("max_attempts")).update(
        status="failed", error="Worker stopped or lost its lease on the final attempt. Explicit retry is required.", finished_at=now,
        lease_token=None, lease_until=None)
    candidates = Job.objects.filter(_eligible(now), attempts__lt=F("max_attempts")).values_list("id", "attempts")[:20]
    for jid, attempts in candidates:
        token = uuid.uuid4()
        won = Job.objects.filter(pk=jid, attempts=attempts).filter(_eligible(now)).update(status="running", attempts=F("attempts") + 1,
            lease_token=token, lease_until=now + timedelta(seconds=getattr(settings, "JOB_LEASE_SECONDS", 300)), updated_at=now)
        if won: return Job.objects.get(pk=jid)
    return None


def assert_owned(job):
    # Call inside the same atomic block as the side effect. Locking the job
    # prevents a competing lease claimant passing the check before commit.
    row = Job.objects.select_for_update().get(pk=job.id)
    if row.status != "running" or row.lease_token != job.lease_token or row.lease_until <= timezone.now():
        raise LeaseLost("Another worker owns this job; stale output was discarded.")


def renew(job):
    now = timezone.now()
    return bool(Job.objects.filter(pk=job.id, status="running", lease_token=job.lease_token, lease_until__gt=now).update(
        lease_until=now + timedelta(seconds=getattr(settings, "JOB_LEASE_SECONDS", 300)), updated_at=now))


def perform(job):
    p = job.payload
    guard = lambda: assert_owned(job)
    if job.kind == "document_parse":
        from documents.models import Document
        from documents.services.documents import run_processing
        with transaction.atomic():
            guard()
            doc = Document.objects.select_for_update().get(pk=p["document_id"])
            if doc.status == "under_review": return {"already_finished": True}
            doc.status = "processing"; doc.processing_started_at = timezone.now(); doc.save(update_fields=["status", "processing_started_at", "updated_at"])
        ok = run_processing(doc.id, guard=guard, run_id=str(job.lease_token), raise_errors=True)
        return {"processed": ok is not False}
    if job.kind == "assessment_grade":
        from assessments.models import AssessmentAttempt, AttemptStatus
        from assessments.services.assessments import _grade, _finalize
        attempt = AssessmentAttempt.objects.select_related("assessment__module", "assessment__chapter", "student").get(pk=p["attempt_id"])
        if attempt.status == AttemptStatus.EVALUATED: return {"already_finished": True}
        if attempt.status not in (AttemptStatus.SUBMITTED, AttemptStatus.PENDING_EVALUATION):
            raise ValueError("The attempt is not submitted")
        score, results, pending = _grade(attempt.assessment, attempt.submitted_answers, source_text=p["source_text"])
        if pending:
            raise RuntimeError("The local evaluator is unavailable. Answers remain saved; no false zero/pass was recorded.")
        with transaction.atomic():
            guard()
            attempt = AssessmentAttempt.objects.select_for_update().select_related("assessment__module", "student").get(pk=attempt.id)
            if attempt.status == AttemptStatus.EVALUATED: return {"already_finished": True}
            _finalize(attempt, score, results, False)
        return {"evaluated": True}
    from django.contrib.auth import get_user_model
    from study import services as authoring, authoring_ai, observations
    actor = get_user_model().objects.get(pk=p["actor_id"], status="active")
    doc = authoring.document_for(actor, p["document_id"])  # permission rechecked when the job actually runs
    if job.kind == "study_bank":
        from study.models import ContentBlock
        block = ContentBlock.objects.get(pk=p["block_id"], active=True, current_revision=p["revision"])
        return {"question_ids": authoring_ai.generate_bank(actor, doc, str(block.id), p["count"], guard=guard, question_type=p.get("question_type", "mcq"))}
    if job.kind == "study_policy":
        aggregates = observations.aggregate(doc)
        if not aggregates: raise ValueError("Not enough aggregate observations for a policy proposal")
        authoring_ai.propose_policy(doc, aggregates, guard=guard)
        return {"proposal_ready": True, "human_review_required": True}
    if job.kind == "study_figures":
        # Content-addressed assets deduplicate a repeated extraction. Faculty
        # placement/approval is separate and cannot be changed by this task.
        return authoring.import_figures(doc)
    raise ValueError("Unhandled job kind")


def run_one(heartbeat=True):
    job = claim()
    if job is None: return None
    stop = threading.Event()
    def pulse():
        while not stop.wait(max(1, getattr(settings, "JOB_LEASE_SECONDS", 300) // 3)):
            try:
                close_old_connections()
                if not renew(job): return
            except Exception:
                logger.exception("Job heartbeat failed; output will be fenced if the lease expires")
            finally:
                close_old_connections()
    thread = threading.Thread(target=pulse, daemon=True) if heartbeat else None
    if thread: thread.start()
    try:
        result = perform(job)
        with transaction.atomic():
            assert_owned(job)
            Job.objects.filter(pk=job.pk, lease_token=job.lease_token).update(status="done", result=result, error="", finished_at=timezone.now(), lease_token=None, lease_until=None)
        return "done"
    except LeaseLost:
        logger.warning("Stale job output discarded: %s", job.id)
        return "discarded"
    except Exception as exc:
        # Do not include raw student input in logs. Details stay in this job's
        # access-controlled record; the HTTP status endpoint returns a safe summary.
        logger.warning("Job %s (%s) failed: %s", job.id, job.kind, type(exc).__name__)
        now = timezone.now()
        failed = job.attempts >= job.max_attempts
        Job.objects.filter(pk=job.pk, status="running", lease_token=job.lease_token).update(
            status="failed" if failed else "retry", error=str(exc)[:1000], lease_token=None, lease_until=None,
            available_at=now + timedelta(seconds=min(600, 15 * 2 ** (job.attempts - 1))), finished_at=now if failed else None)
        return "failed" if failed else "retry"
    finally:
        stop.set()
        if thread: thread.join(timeout=3)
        close_old_connections()


_local_worker = None
_local_worker_lock = threading.Lock()

def start_local_worker():
    """Launcher-only durable queue consumer sharing the embedded model process."""
    global _local_worker
    if not enabled() or settings.TESTING: return False
    with _local_worker_lock:
        if _local_worker is not None and _local_worker.is_alive(): return False
        def loop():
            while True:
                try:
                    close_old_connections()
                    # Yield to foreground use between jobs, never cancel a saved action.
                    from ai.gateway import foreground_busy
                    if foreground_busy():
                        time.sleep(1); continue
                    outcome = run_one()
                    if outcome is None: time.sleep(2)
                except Exception:
                    logger.exception("Persistent worker iteration failed; queued work is retained")
                    time.sleep(5)
        _local_worker = threading.Thread(target=loop, name="persistent-jobs", daemon=True)
        _local_worker.start()
        return True
