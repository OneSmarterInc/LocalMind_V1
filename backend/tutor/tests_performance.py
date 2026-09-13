"""Performance-path tests: retrieval, bounded prompts, task budgets, chunks."""
from unittest.mock import patch

from django.test import TestCase, override_settings

from ai.gateway import AIResult
from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from documents.models import DocumentChunk
from documents.services import chunking, retrieval
from learning.models import Module

from .models import Conversation

# A long module: twelve distinct topics, each a paragraph, so retrieval has
# something to choose between and the whole text is far larger than any
# reasonable tutor prompt.
TOPICS = ["process scheduling and the ready queue", "virtual memory and page tables", "file systems and inodes",
          "deadlock detection and prevention", "semaphores and mutual exclusion", "interrupt handling",
          "device drivers and I/O buffering", "threads versus processes", "context switching cost",
          "the boot sequence", "system calls and the kernel boundary", "disk scheduling algorithms"]


def long_module_text():
    parts = []
    for topic in TOPICS:
        sentences = " ".join(f"This paragraph is about {topic}, sentence {i}, explaining it for a first-time learner in plain words." for i in range(12))
        parts.append(f"## {topic.title()}\n\n{sentences}")
    return "\n\n".join(parts)


class RetrievalTests(TestCase):
    def setUp(self):
        self.subject = make_subject(code="PERF")
        make_published_document(self.subject, modules=(("Operating Systems", long_module_text()),))
        self.module = Module.objects.get(title="Operating Systems")

    def test_split_text_respects_size_and_sentence_boundaries(self):
        chunks = chunking.split_text(long_module_text())
        self.assertGreater(len(chunks), 3)
        for chunk in chunks:
            self.assertLessEqual(len(chunk["text"]), chunking.CHUNK_MAX_CHARS)
            self.assertTrue(chunk["text"].rstrip().endswith("."), "chunks end on a sentence boundary")
        self.assertEqual(chunks[0]["heading"], "Process Scheduling And The Ready Queue")

    def test_chunks_are_built_once_and_keyed_by_version(self):
        self.assertEqual(DocumentChunk.objects.count(), 0)
        first = retrieval.ensure_chunks(self.module)
        self.assertGreater(len(first), 3)
        self.assertEqual(DocumentChunk.objects.count(), len(first))
        again = retrieval.ensure_chunks(self.module)
        self.assertEqual([c.pk for c in first], [c.pk for c in again], "a second call reads, it does not rebuild")
        self.assertTrue(all(c.terms for c in first), "term frequencies are stored with each chunk")
        self.assertTrue(all(c.content_version == 1 for c in first))

    def test_retrieval_returns_relevant_chunks_in_document_order(self):
        hits = retrieval.retrieve(self.module, "How does deadlock detection work?", k=2)
        self.assertTrue(hits)
        self.assertIn("deadlock", hits[0].text.lower() + " ".join(h.text.lower() for h in hits))
        orders = [h.chunk.order for h in hits]
        self.assertEqual(orders, sorted(orders))
        self.assertLessEqual(len(hits), 3)

    def test_retrieval_falls_back_to_leading_chunks_for_unmatched_query(self):
        hits = retrieval.retrieve(self.module, "zzzz qqqq", k=2)
        self.assertEqual([h.chunk.order for h in hits], [0, 1])

    def test_coverage_sample_spans_the_module(self):
        text, count = retrieval.coverage_sample(self.module, 4000)
        self.assertLessEqual(len(text), 4200)
        self.assertGreaterEqual(count, 1)
        full, full_count = retrieval.coverage_sample(self.module, 10 ** 6)
        self.assertEqual(full_count, DocumentChunk.objects.filter(module=self.module).count())


class TutorPromptTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="PERF2")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        make_published_document(self.subject, modules=(("Operating Systems", long_module_text()),))
        self.module = Module.objects.get(title="Operating Systems")
        self.sc = client_for(self.student)
        self.answer = AIResult(ok=True, data={"answer": "Detection walks the wait-for graph.", "grounded": True, "source_reference": "",
                                              "follow_up_suggestions": []}, model="m")

    @patch("tutor.services.gateway")
    def test_ask_sends_retrieved_chunks_not_whole_module(self, gw):
        gw.return_value.generate.return_value = self.answer
        res = self.sc.post(f"/api/student/modules/{self.module.id}/ask/", {"question": "How does deadlock detection work?"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        call = gw.return_value.generate.call_args.kwargs
        prompt = call["user_prompt"]
        self.assertIn("deadlock", prompt.lower())
        self.assertLess(len(prompt), len(self.module.source_text) / 2, "the prompt must not carry the whole module")
        self.assertNotIn("disk scheduling algorithms, sentence 11", prompt, "unrelated passages are left out")
        self.assertEqual(call["task"], "tutor")
        self.assertGreaterEqual(call["retrieved_chunks"], 1)
        self.assertLessEqual(call["retrieved_chunks"], 4)

    @override_settings(AI={**__import__("django.conf").conf.settings.AI, "MAX_CONVERSATION_MESSAGES": 2})
    @patch("tutor.services.gateway")
    def test_conversation_history_is_bounded(self, gw):
        gw.return_value.generate.return_value = self.answer
        conv_id = None
        for i in range(5):
            body = {"question": f"Question number {i} about semaphores and mutual exclusion?"}
            if conv_id:
                body["conversation_id"] = conv_id
            res = self.sc.post(f"/api/student/modules/{self.module.id}/ask/", body, format="json")
            conv_id = res.data["conversation_id"]
        prompt = gw.return_value.generate.call_args.kwargs["user_prompt"]
        history = prompt.split("RECENT CONVERSATION:")[1].split("STUDENT QUESTION:")[0]
        self.assertEqual(history.count("STUDENT:") + history.count("TEACHER:"), 2)
        self.assertEqual(Conversation.objects.get(pk=conv_id).messages.count(), 10)

    @patch("tutor.services.gateway")
    def test_first_question_answer_is_cached_per_module_version(self, gw):
        from django.core.cache import cache

        cache.clear()
        gw.return_value.generate.return_value = self.answer
        q = {"question": "How does deadlock detection work?"}
        self.sc.post(f"/api/student/modules/{self.module.id}/ask/", q, format="json")
        other = make_student()
        enroll(other, self.subject)
        client_for(other).post(f"/api/student/modules/{self.module.id}/ask/", q, format="json")
        self.assertEqual(gw.return_value.generate.call_count, 1, "an identical opening question is served from cache")
        # A content edit moves the version; the cache key moves with it.
        doc = self.module.chapter.document
        doc.content_version += 1
        doc.save()
        client_for(other).post(f"/api/student/modules/{self.module.id}/ask/", q, format="json")
        self.assertEqual(gw.return_value.generate.call_count, 2)

    @patch("tutor.lessons.gateway")
    def test_lesson_uses_lesson_task_and_compact_source(self, gw):
        from tutor import lessons
        lesson = {"title": "T", "learning_objectives": ["a", "b"], "sections": [{"heading": "h", "explanation": "e", "source_reference": "s"}] * 2, "key_terms": [], "summary": "s"}
        gw.return_value.generate.return_value = AIResult(ok=True, data=lesson, model="m")
        lessons.request_lessons([self.module])
        lessons.run_pending(wait_for_students=False)
        call = gw.return_value.generate.call_args.kwargs
        self.assertEqual(call["task"], "lesson")
        self.assertTrue(call["background"])
        self.assertLessEqual(call["source_chars"], 8000 + 500)


class QuizPromptTests(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.subject = make_subject(code="PERF3")
        assign(self.faculty, self.subject)
        make_published_document(self.subject, modules=(("Operating Systems", long_module_text()),))
        self.module = Module.objects.get(title="Operating Systems")

    @patch("assessments.services.generation.gateway")
    def test_quiz_prompts_are_small_batches_of_the_module(self, gw):
        import re

        from assessments.services.generation import CHARS_PER_CALL, MCQ_BATCH, QuizGenerationFailed, generate_questions

        gw.return_value.generate.return_value = AIResult(ok=False, error_code="malformed", error="x")
        with self.assertRaises(QuizGenerationFailed):
            generate_questions([self.module], num_mcqs=5)
        calls = [c.kwargs for c in gw.return_value.generate.call_args_list]
        self.assertGreaterEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call["task"], "quiz")
            self.assertLessEqual(call["source_chars"], CHARS_PER_CALL)
            self.assertNotIn("SOURCE TEXT", call["user_prompt"])
            self.assertIn("Output only the JSON", call["user_prompt"])
            asked = int(re.search(r"exactly (\d+) multiple-choice", call["user_prompt"]).group(1))
            self.assertLessEqual(asked, MCQ_BATCH)
