"""Populate a development database with a small, coherent dataset: one admin,
two faculty, four students, two subjects, one published document per
subject with open modules, a published quiz and an assignment. Never run in
production; refuses unless DEBUG is true or --force is passed."""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from academics import services as academics
from academics.models import Subject
from accounts.models import User
from accounts.services.users import NewUser, create_user
from assessments.services import assessments as quizzes
from assignments import services as assignments
from documents.models import Document, DocumentStatus
from learning.models import Chapter, Module

MODULES = {
    "OS101": ("Operating Systems", "Operating Systems Primer", [
        ("Processes and Scheduling", "A process is a program in execution. The scheduler decides which ready process runs next on the CPU, using policies such as round robin or priority scheduling."),
        ("Memory Management", "Paging divides physical memory into fixed-size frames and logical memory into pages of the same size. Segmentation divides memory by logical units of variable size."),
        ("File Systems", "A file system organises data into files and directories, tracking allocation with structures such as inodes or file allocation tables."),
    ]),
    "DB201": ("Database Systems", "Relational Databases", [
        ("The Relational Model", "A relation is a set of tuples over a fixed set of attributes. Keys identify tuples uniquely; foreign keys reference keys in other relations."),
        ("Normalisation", "Normal forms remove redundancy. Third normal form requires that every non-key attribute depends on the key, the whole key, and nothing but the key."),
    ]),
}

MCQ = lambda q, opts, ans, ref: {"type": "mcq", "question": q, "options": [{"key": k, "text": t} for k, t in zip("ABCD", opts)], "correct_answer": ans, "explanation": ref, "source_reference": ref}


class Command(BaseCommand):
    help = "Seed a development database with demo users, subjects, content, a quiz and an assignment."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Allow running with DEBUG=false.")

    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts["force"]:
            raise CommandError("Refusing to seed with DEBUG=false. Pass --force if you really mean it.")
        if Subject.objects.filter(code__in=MODULES).exists():
            raise CommandError("Demo subjects already exist; seed is not re-runnable on a populated database.")

        admin = self._user("admin@localmind.test", "Demo Admin", "admin")
        faculty = [self._user(f"faculty{i}@localmind.test", f"Faculty {i}", "faculty", {"employee_id": f"F00{i}", "department": "CS"}) for i in (1, 2)]
        students = [self._user(f"student{i}@localmind.test", f"Student {i}", "student", {"roll_number": f"S00{i}", "program": "BSc CS", "batch": "2026"}) for i in (1, 2, 3, 4)]

        for (code, (name, doc_title, modules)), fac in zip(MODULES.items(), faculty):
            subject = academics.create_subject(admin, name, code)
            academics.assign_faculty_to_subjects(admin, fac, [subject.id])
            academics.enroll_students(admin, subject, [s.id for s in students])
            doc = Document.objects.create(subject=subject, uploaded_by=fac, title=doc_title, original_name=f"{doc_title}.pdf", file_type="pdf",
                                          status=DocumentStatus.PUBLISHED, published_at=timezone.now(), published_by=admin, outline_source="edited")
            chapter = Chapter.objects.create(document=doc, title="Chapter 1", order=1, source_heading_index=0)
            for order, (title, text) in enumerate(modules, start=1):
                Module.objects.create(chapter=chapter, title=title, order=order, source_heading_index=order, source_text=text,
                                      availability="open", opened_by=fac, opened_at=timezone.now())
            self.stdout.write(f"  {code}: {len(modules)} open modules, faculty {fac.email}")

        os_module = Module.objects.get(title="Processes and Scheduling")
        quiz = quizzes.create_manual(faculty[0], module_id=str(os_module.id), title="Processes check", questions=[
            MCQ("What is a process?", ["A program in execution", "A file", "A frame", "A key"], "A", "A process is a program in execution."),
            MCQ("What does the scheduler choose?", ["A file", "The next ready process", "A page size", "A directory"], "B", "The scheduler decides which ready process runs next."),
        ])
        quizzes.set_status(faculty[0], quiz, "published")
        assignment = assignments.create(faculty[0], module_id=str(os_module.id), title="Scheduling essay", max_score=10,
                                        description="Compare round robin and priority scheduling.",
                                        rubric=[{"criterion": "Accuracy", "points": 6}, {"criterion": "Clarity", "points": 4}])
        assignments.set_status(faculty[0], assignment, "published")

        pw = settings.LOCALMIND["INITIAL_USER_PASSWORD"]
        self.stdout.write(self.style.SUCCESS(f"Seeded. All accounts use the initial password '{pw}' and must change it at first login."))

    def _user(self, email, name, role, profile=None):
        existing = User.objects.filter(email=email).first()
        if existing:
            return existing
        return create_user(None, NewUser(email=email, full_name=name, role=role, profile=profile or {}))
