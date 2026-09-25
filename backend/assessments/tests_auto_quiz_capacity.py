"""Scheduler boundaries must agree with strict question generation."""
from types import SimpleNamespace
from django.test import SimpleTestCase, override_settings
from .services import auto_quiz
from .services.generation import allocate, CHARS_PER_MCQ, CHARS_PER_SUBJECTIVE


class CapacityTests(SimpleTestCase):
    def check_capacity(self, size, mcqs, written, minimum=0):
        with override_settings(AUTO_QUIZ={"MIN_CHARS": minimum, "MCQS": mcqs, "SUBJECTIVE": written}):
            eligible = not auto_quiz.too_short(SimpleNamespace(source_text="x" * size))
            _, missing_mcqs = allocate(mcqs, [size], CHARS_PER_MCQ)
            _, missing_written = allocate(written, [size], CHARS_PER_SUBJECTIVE)
            expected = bool(size) and size >= minimum and missing_mcqs == 0 and missing_written == 0
            self.assertEqual(eligible, expected, (size, mcqs, written, minimum))

    def test_five_mcqs_at_boundary(self):
        for size in (0, 499, 500, 1249, 1250, 1251):
            with self.subTest(size=size): self.check_capacity(size, 5, 0, 500)

    def test_zero_minimum_never_overrides_capacity(self):
        for size in (0, 1, 500, 1249, 1250):
            with self.subTest(size=size): self.check_capacity(size, 5, 0)

    def test_one_question_matches_generator_minimum(self):
        for size in (0, 1, 10, 249, 250):
            with self.subTest(size=size): self.check_capacity(size, 1, 0)

    def test_written_and_mixed_budgets(self):
        for mcqs, written in ((0, 2), (5, 2), (1, 1), (6, 4)):
            for size in (0, 1, 499, 500, 999, 1000, 1249, 1250, 1999, 2000):
                with self.subTest(size=size, mcqs=mcqs, written=written):
                    self.check_capacity(size, mcqs, written)
