"""Quiz generation: only the chosen modules, spread across them, no
placeholders, and questions a student can read without "the source text"."""
import re
from unittest.mock import patch

from django.test import TestCase

from ai.gateway import AIResult
from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Chapter, Module

from .models import Assessment
from .services.generation import (
    CHARS_PER_CALL, MCQ_BATCH, QuizGenerationFailed, clean_option_text, clean_question_text, generate_questions,
)

PHOTO = ("Photosynthesis happens in the chloroplasts of green leaves. Chlorophyll absorbs sunlight. "
         "Plants take in carbon dioxide through stomata and release oxygen. ") * 12
RESP = ("Respiration releases energy from glucose. Aerobic respiration uses oxygen and produces carbon dioxide "
        "and water. Anaerobic respiration in yeast produces ethanol. ") * 12
DIGEST = ("Digestion begins in the mouth where saliva breaks down starch. The stomach releases hydrochloric acid "
          "and pepsin. The small intestine absorbs digested food through villi. ") * 12
UNCHOSEN = "Transpiration is the loss of water vapour through the stomata of leaves. " * 20


def topic_of(prompt):
    return re.search(r"^TOPIC: (.+)$", prompt, re.M).group(1)


def wanted(prompt, kind):
    m = re.search(rf"exactly (\d+) {kind}", prompt)
    return int(m.group(1)) if m else 0


class FakeModel:
    """Answers each call with exactly the questions it was asked for."""

    def __init__(self, question=None, options=None, explanation=None):
        self.calls = []
        self.question = question or (lambda topic, i: f"Which statement about {topic} is correct (#{i})?")
        self.options = options or (lambda topic, i: [f"{topic} fact {i}-{k}" for k in "ABCD"])
        self.explanation = explanation or (lambda topic, i: f"This is what happens in {topic}.")

    def __call__(self, **kwargs):
        prompt = kwargs["user_prompt"]
        self.calls.append(kwargs)
        topic = topic_of(prompt)
        n = len(self.calls)
        data = {}
        if wanted(prompt, "multiple-choice"):
            data["mcq_questions"] = [{
                "question": self.question(topic, f"{n}.{i}"), "options": self.options(topic, f"{n}.{i}"),
                "answer": "B", "explanation": self.explanation(topic, f"{n}.{i}"), "quote": topic,
            } for i in range(wanted(prompt, "multiple-choice"))]
        if wanted(prompt, "open-ended"):
            data["subjective_questions"] = [{
                "question": f"Explain the main idea of {topic} (#{n}.{i}).", "rubric": "Names the process; gives one example.",
                "quote": topic} for i in range(wanted(prompt, "open-ended"))]
        return AIResult(ok=True, data=data, model="fake")


class Base(TestCase):
    def setUp(self):
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="BIO")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        doc = make_published_document(self.subject, title="Life Processes", modules=(
            ("Photosynthesis", PHOTO), ("Respiration", RESP), ("Transpiration", UNCHOSEN)))
        chapter2 = Chapter.objects.create(document=doc, title="Nutrition", order=2, source_heading_index=10)
        Module.objects.create(chapter=chapter2, title="Digestion", order=1, source_heading_index=11,
                              source_text=DIGEST, availability="open")
        self.photo, self.resp, self.trans, self.digest = (Module.objects.get(title=t) for t in
                                                          ("Photosynthesis", "Respiration", "Transpiration", "Digestion"))
        self.fc = client_for(self.faculty)

    def generate(self, fake, **body):
        with patch("assessments.services.generation.gateway") as gw:
            gw.return_value.generate.side_effect = fake
            return self.fc.post("/api/faculty/quizzes/generate/", body, format="json")


class OnlyTheChosenModulesTests(Base):
    def test_every_prompt_and_question_comes_from_the_chosen_modules_only(self):
        fake = FakeModel()
        res = self.generate(fake, module_ids=[str(self.photo.id), str(self.digest.id)], num_mcqs=6, num_subjective=2)
        self.assertEqual(res.status_code, 201, res.content)
        chosen = {str(self.photo.id), str(self.digest.id)}
        for call in fake.calls:
            prompt = call["user_prompt"]
            self.assertIn(topic_of(prompt), {"Photosynthesis", "Digestion"})
            self.assertNotIn("Transpiration", prompt)
            self.assertNotIn("Respiration releases energy", prompt)
        questions = res.data["questions"]
        self.assertEqual(len(questions), 8)
        self.assertTrue({q["source_module_id"] for q in questions} <= chosen)
        self.assertEqual({q["source_module_id"] for q in questions}, chosen, "both chosen modules contribute")
        quiz = Assessment.objects.get(pk=res.data["id"])
        self.assertEqual(set(map(str, quiz.source_modules.values_list("id", flat=True))), chosen)

    def test_every_chosen_module_gets_at_least_one_question(self):
        fake = FakeModel()
        res = self.generate(fake, module_ids=[str(self.photo.id), str(self.resp.id), str(self.digest.id)], num_mcqs=3)
        self.assertEqual(res.status_code, 201, res.content)
        per_module = {}
        for q in res.data["questions"]:
            per_module[q["source_module_id"]] = per_module.get(q["source_module_id"], 0) + 1
        self.assertEqual(per_module, {str(self.photo.id): 1, str(self.resp.id): 1, str(self.digest.id): 1})

    def test_earlier_questions_about_other_modules_never_reach_the_prompt(self):
        Assessment.objects.create(subject=self.subject, module=self.trans, kind="module", title="Old", generator="ai", questions=[{
            "id": "q1", "type": "mcq", "question": "Through which openings is water vapour lost?",
            "options": [{"key": k, "text": t} for k, t in zip("ABCD", ["Stomata", "Roots", "Xylem", "Bark"])],
            "correct_answer": "A", "explanation": "", "source_reference": "loss of water vapour through the stomata"}])
        Assessment.objects.filter(title="Old").first().source_modules.set([self.trans, self.photo])
        fake = FakeModel()
        res = self.generate(fake, module_ids=[str(self.photo.id)], num_mcqs=3)
        self.assertEqual(res.status_code, 201, res.content)
        for call in fake.calls:
            self.assertNotIn("water vapour", call["user_prompt"])

    def test_long_module_is_asked_in_small_batches_over_different_parts(self):
        fake = FakeModel()
        long_text = "\n\n".join(f"Paragraph {i}: the heart has four chambers and pumps blood through arteries {i}." * 6 for i in range(40))
        Module.objects.filter(pk=self.photo.pk).update(source_text=long_text)
        self.photo.refresh_from_db()
        res = self.generate(fake, module_id=str(self.photo.id), num_mcqs=7)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(len(res.data["questions"]), 7)
        self.assertGreaterEqual(len(fake.calls), 3)
        sources = set()
        for call in fake.calls:
            self.assertLessEqual(wanted(call["user_prompt"], "multiple-choice"), MCQ_BATCH)
            self.assertLessEqual(call["source_chars"], CHARS_PER_CALL)
            sources.add(re.search(r'"""(.*?)"""', call["user_prompt"], re.S).group(1)[:40])
        self.assertGreater(len(sources), 1, "batches read different parts of the module")

    def test_a_short_module_is_not_asked_for_more_than_it_can_carry(self):
        Module.objects.filter(pk=self.photo.pk).update(source_text="Chlorophyll absorbs sunlight in green leaves of plants. " * 5)
        fake = FakeModel()
        res = self.generate(fake, module_id=str(self.photo.id), num_mcqs=10)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(len(res.data["questions"]), 1)
        self.assertIn("not have enough text", res.data["generation_warning"])


class NoPlaceholdersTests(Base):
    def test_ai_unavailable_is_an_error_and_creates_nothing(self):
        res = self.generate(lambda **k: AIResult(ok=False, error_code="unavailable", error="model missing"),
                            module_ids=[str(self.photo.id), str(self.resp.id)], num_mcqs=6)
        self.assertEqual(res.status_code, 503, res.content)
        self.assertEqual(res.data["error"]["code"], "QUIZ_GENERATION_FAILED")
        self.assertFalse(Assessment.objects.exists())

    def test_unavailable_model_stops_at_the_first_failed_call(self):
        calls = []

        def down(**kwargs):
            calls.append(kwargs)
            return AIResult(ok=False, error_code="timeout", error="busy")

        self.generate(down, module_ids=[str(self.photo.id), str(self.resp.id), str(self.digest.id)], num_mcqs=9)
        self.assertEqual(len(calls), 1, "no point waiting for eight more timeouts")

    def test_filler_options_are_never_kept(self):
        fillers = iter([["Option A", "Option B", "Option C", "Option D"],
                        ["Chlorophyll", "All of the above", "Stomata", "Roots"],
                        ["[Placeholder distractor 1 - edit before publishing]", "Glucose", "Oxygen", "Water"]])
        fake = FakeModel(options=lambda topic, i: next(fillers, [f"{topic} real {i}-{k}" for k in "ABCD"]))
        res = self.generate(fake, module_id=str(self.photo.id), num_mcqs=3)
        self.assertEqual(res.status_code, 201, res.content)
        for q in res.data["questions"]:
            texts = [o["text"] for o in q["options"]]
            self.assertEqual(len(set(texts)), 4)
            for t in texts:
                self.assertIsNone(re.match(r"(?i)^(option [a-d]|all of the above|\[)", t), t)
        self.assertIn("not clear enough", res.data["generation_warning"])

    def test_a_cut_off_reply_is_split_instead_of_repeated(self):
        prompts = []
        writer = FakeModel()

        def model(**kwargs):
            prompts.append(wanted(kwargs["user_prompt"], "multiple-choice"))
            if prompts[-1] == 3:
                return AIResult(ok=False, error_code="truncated", error="limit")
            return writer(**kwargs)

        res = self.generate(model, module_id=str(self.photo.id), num_mcqs=3)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(len(res.data["questions"]), 3)
        self.assertEqual(prompts[0], 3)
        self.assertEqual(sorted(prompts[1:3]), [1, 2])

    def test_generated_quiz_can_be_published_and_students_see_real_options(self):
        res = self.generate(FakeModel(), module_id=str(self.photo.id), num_mcqs=2)
        pub = self.fc.post(f"/api/faculty/quizzes/{res.data['id']}/status/", {"status": "published"}, format="json")
        self.assertEqual(pub.status_code, 200, pub.content)
        start = client_for(self.student).post(f"/api/student/quizzes/{res.data['id']}/attempts/")
        self.assertIn(start.status_code, (200, 201), start.content)
        for q in start.data["questions"]:
            self.assertEqual(len(q["options"]), 4)
            self.assertTrue(all("Photosynthesis fact" in o["text"] for o in q["options"]))


class ReadableWordingTests(Base):
    def test_references_to_the_material_are_removed_or_the_question_dropped(self):
        stems = iter(["According to the source text, where does photosynthesis take place?",
                      "What does the passage say about chlorophyll?",
                      "Which gas is released by plants, as mentioned in the text?"])
        fake = FakeModel(question=lambda topic, i: next(stems, f"Which pigment absorbs sunlight in {topic} ({i})?"),
                         explanation=lambda topic, i: "Option B is correct because the source text says so. Leaves hold chloroplasts.")
        res = self.generate(fake, module_id=str(self.photo.id), num_mcqs=3)
        self.assertEqual(res.status_code, 201, res.content)
        texts = [q["question"] for q in res.data["questions"]]
        self.assertIn("Where does photosynthesis take place?", texts)
        self.assertIn("Which gas is released by plants?", texts)
        self.assertNotIn("What does the passage say about chlorophyll?", texts)
        for q in res.data["questions"]:
            blob = " ".join([q["question"], q["explanation"]] + [o["text"] for o in q["options"]])
            self.assertIsNone(re.search(r"(?i)source text|the passage|the text\b|option [a-d]\b", blob), blob)

    def test_options_are_shuffled_and_the_answer_follows_its_text(self):
        res = self.generate(FakeModel(), module_ids=[str(self.photo.id), str(self.resp.id)], num_mcqs=6)
        letters = set()
        for q in res.data["questions"]:
            correct = next(o["text"] for o in q["options"] if o["key"] == q["correct_answer"])
            # The fake always marks its second option (B) as correct.
            self.assertTrue(correct.endswith("-B"), correct)
            letters.add(q["correct_answer"])
        self.assertGreater(len(letters), 1, "the right answer is not always the same letter")

    def test_prompt_never_teaches_the_model_to_say_source_text(self):
        fake = FakeModel()
        self.generate(fake, module_id=str(self.photo.id), num_mcqs=1)
        prompt = fake.calls[0]["system_prompt"] + fake.calls[0]["user_prompt"]
        self.assertNotIn("SOURCE TEXT", prompt)
        self.assertIn("Never mention the text", prompt)


class WordingHelperTests(TestCase):
    def test_question_repair(self):
        self.assertEqual(clean_question_text("In the given passage, where does digestion start?"), "Where does digestion start?")
        self.assertIsNone(clean_question_text("What is described in this module?"))
        self.assertEqual(clean_question_text("Why is the cross section of a leaf important?"), "Why is the cross section of a leaf important?")

    def test_option_rules(self):
        self.assertEqual(clean_option_text("A. Chlorophyll"), "Chlorophyll")
        self.assertEqual(clean_option_text("Both plants and animals"), "Both plants and animals")
        for bad in ("Option C", "None of the above", "Both A and B", "[edit me]", "..."):
            self.assertIsNone(clean_option_text(bad), bad)

    def test_nothing_usable_raises(self):
        module = Module(title="Empty-ish", source_text="Short text about cells and tissues in the body. " * 4)
        with patch("assessments.services.generation.gateway") as gw:
            gw.return_value.generate.return_value = AIResult(ok=True, data={"mcq_questions": [{
                "question": "What does the text say?", "options": ["Option A", "Option B", "Option C", "Option D"],
                "answer": "A", "explanation": "", "quote": ""}]})
            with self.assertRaises(QuizGenerationFailed):
                generate_questions([module], num_mcqs=1)
