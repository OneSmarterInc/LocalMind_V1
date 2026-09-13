from rest_framework import serializers

from learning.models import Chapter, Module
from .models import Document


class ModuleSerializer(serializers.ModelSerializer):
    chapter_id = serializers.UUIDField(read_only=True)
    lesson_status = serializers.SerializerMethodField()
    quiz_status = serializers.SerializerMethodField()
    auto_quiz_id = serializers.SerializerMethodField()

    class Meta:
        model = Module
        fields = ["id", "chapter_id", "title", "order", "source_heading_index", "source_text", "source_missing",
                  "start_page", "end_page", "is_user_edited", "availability", "opened_at", "lesson_status",
                  "quiz_status", "auto_quiz_id", "created_at", "updated_at"]

    def get_lesson_status(self, module) -> str:
        """ready | pending | generating | failed | none (the module has no text)."""
        from tutor import lessons
        # A missing reverse one-to-one raises an AttributeError subclass, so
        # getattr's default covers both "prefetched and absent" and "not loaded".
        return lessons.state_for(module, getattr(module, "lesson", None))

    def get_quiz_status(self, module) -> str:
        """The automatic quiz: ready | pending | generating | failed | dismissed | none | off."""
        from assessments.services import auto_quiz
        return auto_quiz.state_for(module, getattr(module, "auto_quiz_job", None))

    def get_auto_quiz_id(self, module):
        job = getattr(module, "auto_quiz_job", None)
        return str(job.assessment_id) if job and job.assessment_id else None


class ModuleBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ["id", "title", "order", "source_missing", "availability", "start_page", "end_page"]


class ChapterSerializer(serializers.ModelSerializer):
    document_id = serializers.UUIDField(read_only=True)
    modules = ModuleSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ["id", "document_id", "title", "order", "source_heading_index", "source_text", "start_page", "end_page",
                  "is_user_edited", "modules", "created_at", "updated_at"]


class ChapterBriefSerializer(serializers.ModelSerializer):
    modules = ModuleBriefSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = ["id", "title", "order", "modules"]


class DocumentSerializer(serializers.ModelSerializer):
    subject_id = serializers.UUIDField(read_only=True)
    subject_code = serializers.CharField(source="subject.code", read_only=True)
    uploaded_by_id = serializers.UUIDField(read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True, default="")
    published_by_name = serializers.CharField(source="published_by.full_name", read_only=True, default="")
    chapter_count = serializers.SerializerMethodField()
    module_count = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ["id", "subject_id", "subject_code", "title", "original_name", "file_type", "file_size", "status",
                  "outline_strategy", "outline_source", "parse_mode", "error_message", "uploaded_by_id", "uploaded_by_name", "published_by_name",
                  "processed_at", "reviewed_at", "published_at", "unpublished_at", "archived_at",
                  "content_version", "last_edited_at", "chapter_count", "module_count", "progress",
                  "processing_started_at", "created_at", "updated_at"]

    def get_progress(self, doc):
        """Null unless a run is in flight, so the client can simply check for it."""
        if not doc.progress_total_steps:
            return None
        return {
            "step": doc.progress_step,
            "total_steps": doc.progress_total_steps,
            "stage": doc.progress_stage,
            "detail": doc.progress_detail,
            "percent": round(100 * doc.progress_step / doc.progress_total_steps),
        }

    def get_chapter_count(self, doc) -> int:
        return getattr(doc, "chapter_count", None) if hasattr(doc, "chapter_count") else doc.chapters.count()

    def get_module_count(self, doc) -> int:
        return getattr(doc, "module_count", None) if hasattr(doc, "module_count") else Module.objects.filter(chapter__document=doc).count()


class DocumentDetailSerializer(DocumentSerializer):
    chapters = ChapterSerializer(many=True, read_only=True)
    missing_source_modules = serializers.SerializerMethodField()
    lessons = serializers.SerializerMethodField()
    auto_quizzes = serializers.SerializerMethodField()
    background_job = serializers.SerializerMethodField()

    class Meta(DocumentSerializer.Meta):
        fields = DocumentSerializer.Meta.fields + ["extracted_headings", "chapters", "missing_source_modules", "lessons", "auto_quizzes", "background_job"]

    def get_background_job(self, doc) -> dict | None:
        from jobs.models import Job
        job = Job.objects.filter(kind="document_parse", target=str(doc.id)).order_by("-created_at").first()
        return {"id": str(job.id), "status": job.status, "attempts": job.attempts, "error": job.error} if job else None

    def get_missing_source_modules(self, doc):
        """Modules kept without text only because student work refers to them;
        they are hidden from students. Every other empty module is removed."""
        return [str(m.id) for m in Module.objects.filter(chapter__document=doc, source_missing=True)]

    def get_auto_quizzes(self, doc) -> dict:
        """Automatic module quizzes: total / ready / pending / generating / failed / dismissed."""
        from assessments.services import auto_quiz
        return auto_quiz.summary_for_document(doc)

    def get_lessons(self, doc) -> dict:
        """total / ready / pending / generating / failed over modules with text."""
        from tutor import lessons
        return lessons.summary_for_document(doc)


class UploadSerializer(serializers.Serializer):
    outline_strategy = serializers.ChoiceField(choices=["source", "ai"], default="source")
    subject_id = serializers.UUIDField()
    file = serializers.FileField()
    title = serializers.CharField(max_length=300, required=False, allow_blank=True)


class OutlineModuleInSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=300)
    source_heading_index = serializers.IntegerField(required=False, allow_null=True)
    source_text = serializers.CharField(required=False, allow_blank=True)


class OutlineChapterInSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=300)
    source_heading_index = serializers.IntegerField(required=False, allow_null=True)
    source_text = serializers.CharField(required=False, allow_blank=True)
    modules = OutlineModuleInSerializer(many=True, required=False)


class OutlineInSerializer(serializers.Serializer):
    document_title = serializers.CharField(max_length=300, required=False, allow_blank=True)
    chapters = OutlineChapterInSerializer(many=True)


class ContentEditSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    source_text = serializers.CharField(required=False, allow_blank=True)


class AvailabilitySerializer(serializers.Serializer):
    availability = serializers.ChoiceField(choices=["open", "locked"])
