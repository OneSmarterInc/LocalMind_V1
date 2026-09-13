"""Ask a doubt: the right passage, a usable answer, and no dead ends."""
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase

from ai.gateway import AIResult
from core.testing import assign, client_for, enroll, make_faculty, make_published_document, make_student, make_subject
from learning.models import Module

from .models import Conversation, Message

SECTIONS = [
    "Photosynthesis happens in chloroplasts. Chlorophyll absorbs sunlight to make glucose. ",
    "Stomata are tiny pores on leaves. Plants exchange gases through stomata. ",
    "Respiration in cells releases energy from glucose. Mitochondria are where aerobic respiration happens. ",
    "Transport of water in plants happens through xylem vessels from roots to leaves. ",
    "Digestion in humans begins in the mouth. Saliva contains amylase that breaks down starch. ",
    "The small intestine absorbs nutrients through villi. Villi increase the surface area. ",
]
TEXT = "\n\n".join(s * 25 for s in SECTIONS)


def answer(text="Villi absorb nutrients.", grounded=True, ref="absorbs nutrients through villi", suggestions=None):
    return AIResult(ok=True, model="fake", data={"answer": text, "grounded": grounded, "source_reference": ref,
                                                 "follow_up_suggestions": suggestions or []})


class AskBase(TestCase):
    def setUp(self):
        cache.clear()
        self.faculty = make_faculty()
        self.student = make_student()
        self.subject = make_subject(code="ASK")
        assign(self.faculty, self.subject)
        enroll(self.student, self.subject)
        make_published_document(self.subject, modules=(("Life processes", TEXT),))
        self.module = Module.objects.get(title="Life processes")
        self.sc = client_for(self.student)
        self.url = f"/api/student/modules/{self.module.id}/ask/"

    def ask(self, question, conversation_id=None, client=None):
        body = {"question": question}
        if conversation_id:
            body["conversation_id"] = conversation_id
        return (client or self.sc).post(self.url, body, format="json")

    @staticmethod
    def section_of(call):
        prompt = call.kwargs["user_prompt"]
        return prompt.split('"""')[1]


class FindsTheRightPassageTests(AskBase):
    @patch("tutor.services.gateway")
    def test_singular_question_finds_the_plural_in_the_book(self, gw):
        gw.return_value.generate.return_value = answer()
        self.ask("What does a villus do?")
        self.assertIn("villi", self.section_of(gw.return_value.generate.call_args))

    @patch("tutor.services.gateway")
    def test_a_short_follow_up_searches_with_the_previous_question(self, gw):
        gw.return_value.generate.return_value = answer()
        first = self.ask("Which enzyme in saliva breaks down starch?")
        self.assertIn("amylase", self.section_of(gw.return_value.generate.call_args))
        self.ask("Why?", first.data["conversation_id"])
        follow_up_section = self.section_of(gw.return_value.generate.call_args)
        self.assertIn("amylase", follow_up_section, "the follow-up reads the same passage, not the start of the module")


class AlwaysAnUsableAnswerTests(AskBase):
    @patch("tutor.services.gateway")
    def test_an_answer_cut_off_at_the_limit_gets_one_shorter_try(self, gw):
        gw.return_value.generate.side_effect = [AIResult(ok=False, error_code="truncated", error="limit"),
                                                answer("Villi soak up digested food.")]
        res = self.ask("What do villi do?")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["message"]["content"], "Villi soak up digested food.")
        first, second = gw.return_value.generate.call_args_list
        self.assertNotIn("truncated", first.kwargs["retry_codes"])
        self.assertNotIn("follow_up_suggestions", second.kwargs["schema"]["properties"])
        self.assertGreater(second.kwargs["max_tokens"], 0)

    @patch("tutor.services.gateway")
    def test_answers_and_suggestions_never_talk_about_the_source_text(self, gw):
        gw.return_value.generate.return_value = answer(
            "According to the source text, villi absorb nutrients. The passage says each villus increases the surface area.",
            suggestions=["What does the text say about the stomach?", "How is starch broken down?"])
        res = self.ask("What do villi do?")
        content = res.data["message"]["content"]
        self.assertEqual(content, "Villi absorb nutrients. Each villus increases the surface area.")
        self.assertEqual(res.data["follow_up_suggestions"], ["How is starch broken down?"])
        prompt = gw.return_value.generate.call_args.kwargs
        self.assertNotIn("SOURCE TEXT", prompt["user_prompt"] + prompt["system_prompt"])

    @patch("tutor.services.gateway")
    def test_off_topic_question_gets_guidance_not_an_invented_answer(self, gw):
        gw.return_value.generate.return_value = answer("The source does not cover football.", grounded=False)
        res = self.ask("Who won the football world cup?")
        msg = res.data["message"]
        self.assertFalse(msg["grounded"])
        self.assertIn("Life processes", msg["content"])
        self.assertEqual(msg["source_reference"], "")


class NoDeadEndsTests(AskBase):
    @patch("tutor.services.gateway")
    def test_asking_again_after_a_failure_does_not_repeat_the_question(self, gw):
        gw.return_value.generate.return_value = answer()
        first = self.ask("What do villi do?")
        conv = first.data["conversation_id"]
        gw.return_value.generate.return_value = AIResult(ok=False, error_code="timeout", error="busy")
        failed = self.ask("And the stomach?", conv)
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(failed.data["error"]["details"]["conversation_id"], conv)
        gw.return_value.generate.return_value = answer("The stomach releases acid.")
        again = self.ask("And the stomach?", conv)
        self.assertEqual(again.status_code, 201, again.content)
        roles = list(Conversation.objects.get(pk=conv).messages.values_list("role", "content"))
        self.assertEqual([r for r, _ in roles], ["user", "assistant", "user", "assistant"])
        prompt = gw.return_value.generate.call_args.kwargs["user_prompt"]
        history = prompt.split("RECENT CONVERSATION:")[1].split("STUDENT QUESTION:")[0]
        self.assertNotIn("And the stomach?", history)

    def test_model_down_keeps_the_question_and_says_why(self):
        res = self.ask("What do villi do?")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["error"]["code"], "AI_UNAVAILABLE")
        conv = Conversation.objects.get(pk=res.data["error"]["details"]["conversation_id"])
        self.assertEqual(list(conv.messages.values_list("role", flat=True)), ["user"])

    @patch("tutor.services.gateway")
    def test_access_rules(self, gw):
        gw.return_value.generate.return_value = answer()
        mine = self.ask("What do villi do?").data["conversation_id"]
        other = make_student()
        enroll(other, self.subject)
        self.assertEqual(self.ask("Continue", mine, client=client_for(other)).status_code, 404)
        self.assertEqual(self.ask("Hello", client=client_for(make_student())).status_code, 404)
        client_for(self.faculty).post(f"/api/faculty/modules/{self.module.id}/availability/", {"availability": "locked"}, format="json")
        self.assertEqual(self.ask("What do villi do?").status_code, 403)

    @patch("tutor.services.gateway")
    def test_the_same_opening_question_is_answered_from_cache_and_cleaned(self, gw):
        gw.return_value.generate.return_value = answer("According to the text, villi absorb nutrients.")
        self.ask("What do villi do?")
        other = make_student()
        enroll(other, self.subject)
        res = self.ask("what do villi do?", client=client_for(other))
        self.assertEqual(gw.return_value.generate.call_count, 1)
        self.assertEqual(res.data["message"]["content"], "Villi absorb nutrients.")
        self.assertEqual(Message.objects.filter(role="assistant").count(), 2)
