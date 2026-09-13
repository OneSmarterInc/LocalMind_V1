"""Read-only aggregation over progress, attempts, submissions, sessions and
activity events. Every function takes the acting user and scopes the data it
returns: students see only themselves, faculty only their assigned subjects,
admins everything. No new state is written here.

Date filtering uses an optional (since, until) pair of aware datetimes and
applies to time-stamped facts (attempts, submissions, sessions, events).
Structural facts such as enrollment counts are point-in-time.
"""

from datetime import timedelta

from django.db.models import Avg, Count, Max, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from academics.models import Enrollment, FacultySubject, Subject, faculty_manages_subject, student_enrolled_in_subject
from accounts.models import User
from activity.models import ActivityEvent, ApplicationSession
from assessments.models import Assessment, AssessmentAttempt
from assignments.models import Assignment, AssignmentSubmission
from core.exceptions import NotFound, ValidationFailed
from core.utils import get_or_404
from documents.models import Document
from learning.models import Module, ModuleProgress


# ---------------------------------------------------------------- windows ---

def parse_window(params):
    """Reads ?since= and ?until= ISO-8601 values. Naive values are treated as
    UTC. Returns (since, until) with either possibly None."""
    out = []
    for key in ("since", "until"):
        raw = params.get(key)
        if not raw:
            out.append(None)
            continue
        # A "+" in an unencoded query string arrives as a space; repair that case.
        value = parse_datetime(raw.strip()) or parse_datetime(raw.replace(" ", "+"))
        if value is None:
            raise ValidationFailed(f"'{key}' must be an ISO-8601 datetime.")
        if timezone.is_naive(value):
            value = timezone.make_aware(value, timezone.utc)
        out.append(value)
    since, until = out
    if since and until and since > until:
        raise ValidationFailed("'since' must be earlier than 'until'.")
    return since, until


def _between(qs, field, window):
    since, until = window
    if since:
        qs = qs.filter(**{f"{field}__gte": since})
    if until:
        qs = qs.filter(**{f"{field}__lte": until})
    return qs


def _seconds(qs):
    return qs.aggregate(total=Sum("seconds"))["total"] or 0


def _session_seconds(qs):
    return qs.aggregate(total=Sum("duration_seconds"))["total"] or 0


# --------------------------------------------------------------- scoping ----

def scoped_subjects(user):
    return Subject.objects.visible_to(user)


def resolve_subject(user, subject_id):
    return get_or_404(scoped_subjects(user), pk=subject_id)


def resolve_student(actor, student_id):
    """A faculty member may look at a student only through a subject they
    both share; an admin may look at anyone."""
    student = get_or_404(User.objects.filter(role="student"), pk=student_id)
    if actor.is_admin:
        return student
    shared = Enrollment.objects.filter(
        student=student, status="active",
        subject__in=FacultySubject.objects.filter(faculty=actor, status="active").values("subject"),
    ).exists()
    if not shared:
        raise NotFound("User not found.")
    return student


# ------------------------------------------------------------- student ------

def _released_attempts(qs):
    """Only attempts whose result the student has been given."""
    from assessments.models import results_visible_q
    return qs.filter(results_visible_q())


def _released_submissions(qs):
    return qs.filter(AssignmentSubmission.visible_q())


def student_overview(student, window=(None, None), released_only=False):
    """``released_only`` is True when the student reads their own overview:
    held quiz and assignment results then stay out of every count and average.
    Faculty and admins looking at a student see everything."""
    if released_only:
        from learning.services import settle_student_results
        settle_student_results(student)
    enrollments = Enrollment.objects.filter(student=student, status="active").select_related("subject")
    subjects = [e.subject for e in enrollments]
    modules = Module.objects.filter(chapter__document__subject__in=subjects, chapter__document__status="published", source_missing=False)
    progress = ModuleProgress.objects.filter(student=student, module__in=modules)
    status_counts = {row["status"]: row["n"] for row in progress.values("status").annotate(n=Count("id"))}
    total_modules = modules.count()
    completed = status_counts.get("completed", 0)

    attempts = _between(AssessmentAttempt.objects.filter(student=student, status="evaluated"), "submitted_at", window)
    submissions = _between(AssignmentSubmission.objects.filter(student=student), "submitted_at", window)
    # Counts of what was submitted are the student's own knowledge; outcomes
    # (passed, averages, evaluated) come only from released results.
    scored_attempts = _released_attempts(attempts) if released_only else attempts
    scored_submissions = _released_submissions(submissions) if released_only else submissions
    quiz_stats = {**attempts.aggregate(n=Count("id")),
                  **scored_attempts.aggregate(avg=Avg("percentage"), passed=Count("id", filter=Q(passed=True)))}
    sub_stats = {**submissions.aggregate(n=Count("id"), late=Count("id", filter=Q(is_late=True))),
                 **scored_submissions.aggregate(evaluated=Count("id", filter=Q(status="evaluated")), avg=Avg("score"))}

    events = _between(ActivityEvent.objects.filter(user=student), "occurred_at", window)
    time_by_kind = {row["kind"]: row["s"] for row in events.values("kind").annotate(s=Sum("seconds"))}
    sessions = _between(ApplicationSession.objects.filter(user=student, logout_at__isnull=False), "login_at", window)

    return {
        "student": {"id": str(student.id), "email": student.email, "full_name": student.full_name},
        "subjects_enrolled": len(subjects),
        "modules": {
            "total": total_modules,
            "completed": completed,
            "in_progress": status_counts.get("in_progress", 0),
            "needs_review": status_counts.get("needs_review", 0),
            "not_started": max(0, total_modules - sum(status_counts.values())),
            "completion_percentage": round(100.0 * completed / total_modules, 1) if total_modules else 0.0,
        },
        "quizzes": {
            "attempts": quiz_stats["n"],
            "passed": quiz_stats["passed"],
            "average_percentage": round(quiz_stats["avg"], 1) if quiz_stats["avg"] is not None else None,
            "pending_evaluation": AssessmentAttempt.objects.filter(student=student, status="pending_evaluation").count(),
        },
        "assignments": {
            "submitted": sub_stats["n"],
            "evaluated": sub_stats["evaluated"],
            "late": sub_stats["late"],
            "average_score": round(sub_stats["avg"], 1) if sub_stats["avg"] is not None else None,
        },
        "time": {
            "learning_seconds": time_by_kind.get("learning", 0),
            "quiz_seconds": time_by_kind.get("quiz", 0),
            "assignment_seconds": time_by_kind.get("assignment", 0),
            "tutor_seconds": time_by_kind.get("tutor", 0),
            "session_seconds": _session_seconds(sessions),
            "sessions": sessions.count(),
        },
        "window": _window_out(window),
    }


def student_subject_detail(student, subject, window=(None, None), released_only=False):
    if not student_enrolled_in_subject(student, subject):
        raise NotFound("Subject not found.")
    if released_only:
        from learning.services import settle_student_results
        settle_student_results(student)
    modules = (Module.objects.filter(chapter__document__subject=subject, chapter__document__status="published", source_missing=False)
               .select_related("chapter", "chapter__document").order_by("chapter__document__title", "chapter__order", "order"))
    progress = {p.module_id: p for p in ModuleProgress.objects.filter(student=student, module__in=modules)}
    rows = []
    for m in modules:
        p = progress.get(m.id)
        rows.append({
            "module_id": str(m.id), "title": m.title, "chapter": m.chapter.title, "document": m.chapter.document.title,
            "availability": m.availability,
            "status": p.status if p else "not_started",
            "best_quiz_percentage": p.best_quiz_percentage if p else None,
            "quiz_attempts": p.quiz_attempts if p else 0,
            "learning_seconds": p.learning_seconds if p else 0,
            "last_viewed_at": p.last_viewed_at if p else None,
        })
    attempts = _between(AssessmentAttempt.objects.filter(student=student, assessment__subject=subject, status="evaluated"), "submitted_at", window)
    subs = _between(AssignmentSubmission.objects.filter(student=student, assignment__subject=subject), "submitted_at", window)
    if released_only:
        attempts, subs = _released_attempts(attempts), _released_submissions(subs)
    recent = []
    if not released_only:
        for att in (AssessmentAttempt.objects.filter(student=student, assessment__subject=subject).exclude(status="in_progress")
                    .select_related("assessment").order_by("-submitted_at")[:20]):
            recent.append({
                "id": str(att.id), "quiz_id": str(att.assessment_id), "quiz_title": att.assessment.title,
                "attempt_number": att.attempt_number, "status": att.status, "percentage": att.percentage,
                "passed": att.passed, "submitted_at": att.submitted_at, "results_released": bool(att.results_visible),
            })
    return {
        "subject": {"id": str(subject.id), "code": subject.code, "name": subject.name},
        "modules": rows,
        "quiz_attempts": recent,
        "quiz_average": round(attempts.aggregate(a=Avg("percentage"))["a"], 1) if attempts.exists() else None,
        "assignment_average": round(subs.aggregate(a=Avg("score"))["a"], 1) if subs.filter(score__isnull=False).exists() else None,
        "time": {
            "learning_seconds": _seconds(_between(ActivityEvent.objects.filter(user=student, subject=subject, kind="learning"), "occurred_at", window)),
            "quiz_seconds": _seconds(_between(ActivityEvent.objects.filter(user=student, subject=subject, kind="quiz"), "occurred_at", window)),
            "assignment_seconds": _seconds(_between(ActivityEvent.objects.filter(user=student, subject=subject, kind="assignment"), "occurred_at", window)),
        },
        "window": _window_out(window),
    }


# ------------------------------------------------------------- faculty ------

def subject_summary(actor, subject, window=(None, None)):
    if not faculty_manages_subject(actor, subject):
        raise NotFound("Subject not found.")
    enrolled = Enrollment.objects.filter(subject=subject, status="active")
    students = User.objects.filter(pk__in=enrolled.values("student"))
    modules = Module.objects.filter(chapter__document__subject=subject, chapter__document__status="published", source_missing=False)
    total_cells = students.count() * modules.count()
    completed_cells = ModuleProgress.objects.filter(student__in=students, module__in=modules, status="completed").count()

    attempts = _between(AssessmentAttempt.objects.filter(assessment__subject=subject, status="evaluated"), "submitted_at", window)
    q = attempts.aggregate(n=Count("id"), avg=Avg("percentage"), passed=Count("id", filter=Q(passed=True)), students=Count("student", distinct=True))
    subs = _between(AssignmentSubmission.objects.filter(assignment__subject=subject), "submitted_at", window)
    s = subs.aggregate(n=Count("id"), avg=Avg("score"), late=Count("id", filter=Q(is_late=True)), pending=Count("id", filter=Q(status="submitted")))

    events = _between(ActivityEvent.objects.filter(subject=subject, user__in=students), "occurred_at", window)
    time_by_kind = {row["kind"]: row["s"] for row in events.values("kind").annotate(s=Sum("seconds"))}
    active_students = events.values("user").distinct().count()

    return {
        "subject": {"id": str(subject.id), "code": subject.code, "name": subject.name, "status": subject.status},
        "students_enrolled": students.count(),
        "students_active_in_window": active_students,
        "documents": {
            "total": Document.objects.filter(subject=subject).exclude(status="archived").count(),
            "published": Document.objects.filter(subject=subject, status="published").count(),
        },
        "modules": {
            "total": modules.count(),
            "open": modules.filter(availability="open").count(),
            "completion_percentage": round(100.0 * completed_cells / total_cells, 1) if total_cells else 0.0,
        },
        "quizzes": {
            "published": Assessment.objects.filter(subject=subject, status="published").count(),
            "attempts": q["n"], "passed": q["passed"], "students_attempted": q["students"],
            "average_percentage": round(q["avg"], 1) if q["avg"] is not None else None,
            "pending_evaluation": AssessmentAttempt.objects.filter(assessment__subject=subject, status="pending_evaluation").count(),
        },
        "assignments": {
            "published": Assignment.objects.filter(subject=subject, status="published").count(),
            "submissions": s["n"], "late": s["late"], "awaiting_evaluation": s["pending"],
            "average_score": round(s["avg"], 1) if s["avg"] is not None else None,
        },
        "time": {
            "learning_seconds": time_by_kind.get("learning", 0),
            "quiz_seconds": time_by_kind.get("quiz", 0),
            "assignment_seconds": time_by_kind.get("assignment", 0),
            "tutor_seconds": time_by_kind.get("tutor", 0),
        },
        "window": _window_out(window),
    }


def subject_students(actor, subject, window=(None, None)):
    """One row per enrolled student: completion, quiz average, time, last seen."""
    if not faculty_manages_subject(actor, subject):
        raise NotFound("Subject not found.")
    modules = Module.objects.filter(chapter__document__subject=subject, chapter__document__status="published", source_missing=False)
    total = modules.count()
    enrolled = Enrollment.objects.filter(subject=subject, status="active").select_related("student", "student__student_profile").order_by("student__full_name")

    completed = {r["student"]: r["n"] for r in ModuleProgress.objects.filter(module__in=modules, status="completed").values("student").annotate(n=Count("id"))}
    needs_review = {r["student"]: r["n"] for r in ModuleProgress.objects.filter(module__in=modules, status="needs_review").values("student").annotate(n=Count("id"))}
    attempts = _between(AssessmentAttempt.objects.filter(assessment__subject=subject, status="evaluated"), "submitted_at", window)
    quiz = {r["student"]: r for r in attempts.values("student").annotate(n=Count("id"), avg=Avg("percentage"), best=Max("percentage"), passed=Count("id", filter=Q(passed=True)))}
    subs = _between(AssignmentSubmission.objects.filter(assignment__subject=subject), "submitted_at", window)
    assign = {r["student"]: r for r in subs.values("student").annotate(n=Count("id"), avg=Avg("score"), late=Count("id", filter=Q(is_late=True)))}
    events = _between(ActivityEvent.objects.filter(subject=subject), "occurred_at", window)
    time = {r["user"]: r for r in events.values("user").annotate(learning=Sum("seconds", filter=Q(kind="learning")), quiz=Sum("seconds", filter=Q(kind="quiz")), assignment=Sum("seconds", filter=Q(kind="assignment")), last=Max("occurred_at"))}
    sessions = _between(ApplicationSession.objects.filter(logout_at__isnull=False, user__in=enrolled.values("student")), "login_at", window)
    app_time = {r["user"]: r for r in sessions.values("user").annotate(s=Sum("duration_seconds"), n=Count("id"), last=Max("login_at"))}

    rows = []
    for e in enrolled:
        sid = e.student_id
        q, a, t = quiz.get(sid, {}), assign.get(sid, {}), time.get(sid, {})
        profile = getattr(e.student, "student_profile", None)
        rows.append({
            "student_id": str(sid), "email": e.student.email, "full_name": e.student.full_name,
            "roll_number": profile.roll_number if profile else "",
            "modules_completed": completed.get(sid, 0), "modules_needs_review": needs_review.get(sid, 0), "modules_total": total,
            "completion_percentage": round(100.0 * completed.get(sid, 0) / total, 1) if total else 0.0,
            "quiz_attempts": q.get("n", 0), "quiz_passed": q.get("passed", 0),
            "quiz_average": round(q["avg"], 1) if q.get("avg") is not None else None,
            "best_quiz_percentage": round(q["best"], 1) if q.get("best") is not None else None,
            "assignments_submitted": a.get("n", 0), "assignments_late": a.get("late", 0),
            "assignment_average": round(a["avg"], 1) if a.get("avg") is not None else None,
            "learning_seconds": t.get("learning") or 0, "quiz_seconds": t.get("quiz") or 0, "assignment_seconds": t.get("assignment") or 0,
            "session_seconds": app_time.get(sid, {}).get("s") or 0, "sessions": app_time.get(sid, {}).get("n") or 0,
            "last_login_at": app_time.get(sid, {}).get("last"),
            "last_activity_at": t.get("last"),
        })
    return {"subject": {"id": str(subject.id), "code": subject.code, "name": subject.name}, "students": rows, "window": _window_out(window)}


def subject_modules(actor, subject):
    """Per-module funnel across the enrolled cohort, plus quiz difficulty."""
    if not faculty_manages_subject(actor, subject):
        raise NotFound("Subject not found.")
    students = Enrollment.objects.filter(subject=subject, status="active").values("student")
    n_students = students.count()
    modules = (Module.objects.filter(chapter__document__subject=subject, chapter__document__status="published", source_missing=False)
               .select_related("chapter", "chapter__document").order_by("chapter__document__title", "chapter__order", "order"))
    prog = {}
    for r in ModuleProgress.objects.filter(module__in=modules, student__in=students).values("module", "status").annotate(n=Count("id")):
        prog.setdefault(r["module"], {})[r["status"]] = r["n"]
    quiz = {r["assessment__module"]: r for r in AssessmentAttempt.objects.filter(assessment__module__in=modules, status="evaluated").values("assessment__module").annotate(n=Count("id"), avg=Avg("percentage"), passed=Count("id", filter=Q(passed=True)))}
    learn = {r["module"]: r["s"] for r in ActivityEvent.objects.filter(module__in=modules, kind="learning", user__in=students).values("module").annotate(s=Sum("seconds"))}
    rows = []
    for m in modules:
        p, q = prog.get(m.id, {}), quiz.get(m.id, {})
        started = sum(p.values())
        rows.append({
            "module_id": str(m.id), "title": m.title, "chapter": m.chapter.title, "document": m.chapter.document.title,
            "availability": m.availability, "source_missing": m.source_missing,
            "students_started": started, "students_completed": p.get("completed", 0), "students_needs_review": p.get("needs_review", 0),
            "students_not_started": max(0, n_students - started),
            "quiz_attempts": q.get("n", 0),
            "quiz_pass_rate": round(100.0 * q["passed"] / q["n"], 1) if q.get("n") else None,
            "quiz_average": round(q["avg"], 1) if q.get("avg") is not None else None,
            "avg_learning_seconds": round(learn.get(m.id, 0) / n_students) if n_students else 0,
        })
    return {"subject": {"id": str(subject.id), "code": subject.code, "name": subject.name}, "students_enrolled": n_students, "modules": rows}


def faculty_overview(actor, window=(None, None)):
    subjects = scoped_subjects(actor).exclude(status="archived").order_by("code")
    return {"subjects": [subject_summary(actor, s, window) for s in subjects], "window": _window_out(window)}


# ------------------------------------------------------------- admin --------

def teaching_activity(actor, days=14, limit=8):
    """Recent things that happened in the subjects this person teaches, newest first.

    Built from the records that already exist (attempts, submissions, books,
    lessons), grouped per item and day so a class of thirty submitting the same
    quiz reads as one line rather than thirty.
    """
    from tutor.models import ModuleLesson
    since = timezone.now() - timedelta(days=days)
    subjects = scoped_subjects(actor)
    items = []

    def day(dt):
        return timezone.localtime(dt).date()

    groups = {}
    for att in (AssessmentAttempt.objects.filter(assessment__subject__in=subjects, submitted_at__gte=since)
                .exclude(status="in_progress").select_related("assessment", "assessment__subject")):
        key = ("quiz", att.assessment_id, day(att.submitted_at))
        g = groups.setdefault(key, {"count": 0, "evaluated": 0, "at": att.submitted_at, "title": att.assessment.title,
                                    "subject": att.assessment.subject.code, "id": str(att.assessment_id)})
        g["count"] += 1; g["evaluated"] += att.status == "evaluated"; g["at"] = max(g["at"], att.submitted_at)
    for (_, _, _), g in [(k, v) for k, v in groups.items() if k[0] == "quiz"]:
        n = g["count"]
        items.append({"kind": "quiz_attempts", "title": f"{n} quiz attempt{'s' if n != 1 else ''} {'evaluated' if g['evaluated'] == n else 'submitted'}",
                      "detail": g["title"], "subject": g["subject"], "at": g["at"], "target_id": g["id"]})
    subs = {}
    for sub in (AssignmentSubmission.objects.filter(assignment__subject__in=subjects, submitted_at__gte=since)
                .select_related("assignment", "assignment__subject")):
        key = (sub.assignment_id, day(sub.submitted_at))
        g = subs.setdefault(key, {"count": 0, "at": sub.submitted_at, "title": sub.assignment.title, "subject": sub.assignment.subject.code, "id": str(sub.assignment_id)})
        g["count"] += 1; g["at"] = max(g["at"], sub.submitted_at)
    for g in subs.values():
        n = g["count"]
        items.append({"kind": "assignment_submissions", "title": f"{n} assignment submission{'s' if n != 1 else ''} received",
                      "detail": g["title"], "subject": g["subject"], "at": g["at"], "target_id": g["id"]})
    labels = {"under_review": "Book ready for review", "ready": "Book marked ready", "published": "Book published", "error": "Book processing failed"}
    for doc in Document.objects.filter(subject__in=subjects, updated_at__gte=since, status__in=list(labels)).select_related("subject"):
        items.append({"kind": "document", "title": labels[doc.status], "detail": doc.title, "subject": doc.subject.code,
                      "at": doc.published_at if doc.status == "published" and doc.published_at else doc.updated_at, "target_id": str(doc.id)})
    lessons = {}
    for lesson in (ModuleLesson.objects.filter(module__chapter__document__subject__in=subjects, status="ready", updated_at__gte=since)
                   .select_related("module__chapter__document__subject")):
        doc = lesson.module.chapter.document
        g = lessons.setdefault((doc.id, day(lesson.updated_at)), {"count": 0, "at": lesson.updated_at, "title": doc.title, "subject": doc.subject.code, "id": str(doc.id)})
        g["count"] += 1; g["at"] = max(g["at"], lesson.updated_at)
    for g in lessons.values():
        n = g["count"]
        items.append({"kind": "lessons", "title": f"{n} lesson{'s' if n != 1 else ''} generated", "detail": g["title"],
                      "subject": g["subject"], "at": g["at"], "target_id": g["id"]})
    items.sort(key=lambda x: x["at"], reverse=True)
    return {"items": items[:limit], "window_days": days}


def admin_overview(window=(None, None)):
    users = User.objects.values("role", "status").annotate(n=Count("id"))
    by_role = {}
    for r in users:
        by_role.setdefault(r["role"], {})[r["status"]] = r["n"]
    attempts = _between(AssessmentAttempt.objects.filter(status="evaluated"), "submitted_at", window)
    subs = _between(AssignmentSubmission.objects.all(), "submitted_at", window)
    sessions = _between(ApplicationSession.objects.filter(logout_at__isnull=False), "login_at", window)
    events = _between(ActivityEvent.objects.all(), "occurred_at", window)
    time_by_kind = {row["kind"]: row["s"] for row in events.values("kind").annotate(s=Sum("seconds"))}
    docs = {r["status"]: r["n"] for r in Document.objects.values("status").annotate(n=Count("id"))}
    subj = {r["status"]: r["n"] for r in Subject.objects.values("status").annotate(n=Count("id"))}
    return {
        "users": by_role,
        "subjects": subj,
        "enrollments_active": Enrollment.objects.filter(status="active").count(),
        "faculty_assignments_active": FacultySubject.objects.filter(status="active").count(),
        "documents": docs,
        "modules": {"total": Module.objects.count(), "open": Module.objects.filter(availability="open").count(), "source_missing": Module.objects.filter(source_missing=True).count()},
        "quizzes": {
            "published": Assessment.objects.filter(status="published").count(),
            "attempts": attempts.count(),
            "average_percentage": round(attempts.aggregate(a=Avg("percentage"))["a"], 1) if attempts.exists() else None,
            "pending_evaluation": AssessmentAttempt.objects.filter(status="pending_evaluation").count(),
        },
        "assignments": {
            "published": Assignment.objects.filter(status="published").count(),
            "submissions": subs.count(),
            "awaiting_evaluation": AssignmentSubmission.objects.filter(status="submitted").count(),
        },
        "activity": {
            "sessions": sessions.count(),
            "session_seconds": _session_seconds(sessions),
            "distinct_users_with_sessions": sessions.values("user").distinct().count(),
            "learning_seconds": time_by_kind.get("learning", 0),
            "quiz_seconds": time_by_kind.get("quiz", 0),
            "assignment_seconds": time_by_kind.get("assignment", 0),
            "tutor_seconds": time_by_kind.get("tutor", 0),
        },
        "window": _window_out(window),
    }


def admin_subjects(window=(None, None)):
    """Cross-subject table for the admin dashboard, with faculty names."""
    rows = []
    for s in Subject.objects.exclude(status="archived").order_by("code"):
        faculty = list(FacultySubject.objects.filter(subject=s, status="active").select_related("faculty").values_list("faculty__full_name", flat=True))
        attempts = _between(AssessmentAttempt.objects.filter(assessment__subject=s, status="evaluated"), "submitted_at", window)
        events = _between(ActivityEvent.objects.filter(subject=s), "occurred_at", window)
        rows.append({
            "subject_id": str(s.id), "code": s.code, "name": s.name, "status": s.status, "faculty": faculty,
            "students_enrolled": Enrollment.objects.filter(subject=s, status="active").count(),
            "documents_published": Document.objects.filter(subject=s, status="published").count(),
            "modules_published": Module.objects.filter(chapter__document__subject=s, chapter__document__status="published", source_missing=False).count(),
            "quiz_attempts": attempts.count(),
            "quiz_average": round(attempts.aggregate(a=Avg("percentage"))["a"], 1) if attempts.exists() else None,
            "students_active_in_window": events.values("user").distinct().count(),
            "total_activity_seconds": _seconds(events),
        })
    return {"subjects": rows, "window": _window_out(window)}


def user_sessions(actor, user_id, window=(None, None), limit=50):
    """Session log for one user. Admin sees anyone; faculty sees shared students; a student sees only themself."""
    if actor.is_student:
        if str(actor.id) != str(user_id):
            raise NotFound("User not found.")
        target = actor
    elif actor.is_admin:
        target = get_or_404(User.objects.all(), pk=user_id)
    else:
        target = resolve_student(actor, user_id)
    sessions = _between(ApplicationSession.objects.filter(user=target), "login_at", window)[: max(1, min(int(limit or 50), 200))]
    return {
        "user": {"id": str(target.id), "email": target.email, "full_name": target.full_name, "role": target.role},
        "total_seconds": _session_seconds(_between(ApplicationSession.objects.filter(user=target, logout_at__isnull=False), "login_at", window)),
        "sessions": [
            {"id": str(x.id), "login_at": x.login_at, "last_heartbeat_at": x.last_heartbeat_at, "logout_at": x.logout_at,
             "ended_by": x.ended_by, "duration_seconds": x.duration_seconds, "open": x.is_open}
            for x in sessions
        ],
        "window": _window_out(window),
    }


def _window_out(window):
    since, until = window
    return {"since": since, "until": until}
