"""Measure the embedded model on this machine with fixed prompts.

    python manage.py benchmark_ai                 # load + tutor + quiz + lesson
    python manage.py benchmark_ai --tasks tutor   # one task
    python manage.py benchmark_ai --repeat 3      # median of three
    python manage.py benchmark_ai --json          # machine-readable

Prompts are fixed text with deterministic sampling (temperature 0), so two
runs on the same build are comparable and a change in ai/config.py shows up
as a change in the numbers. Reports load time, per-task latency, prompt and
generated tokens and tokens/second, plus the active performance profile.
Never run from a request handler.
"""
import json
import statistics
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai import config as ai_config
from ai.gateway import AIGateway, get_provider
from ai.prompts import SYSTEM_PROMPT, build_user_prompt

SOURCE = (
    "Processes are programs in execution. Each process has its own address space, a program counter and a set of "
    "registers saved in its process control block. The scheduler picks the next process to run on the CPU using a "
    "policy such as round robin, where every runnable process receives a fixed time slice in turn, or priority "
    "scheduling, where the highest-priority runnable process goes first. A context switch saves the state of the "
    "running process and restores the state of the next one; it costs time because caches and translation buffers "
    "are refilled afterwards. Threads share an address space with their process, so switching between threads of "
    "one process is cheaper than switching between processes. A deadlock occurs when a set of processes each wait "
    "for a resource held by another member of the set; it can be prevented by ordering resources, avoided with the "
    "banker's algorithm, or detected by finding a cycle in the wait-for graph. "
) * 3

TUTOR_SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "grounded": {"type": "boolean"},
                                                 "source_reference": {"type": "string"},
                                                 "follow_up_suggestions": {"type": "array", "maxItems": 3, "items": {"type": "string"}}},
                "required": ["answer", "grounded", "source_reference", "follow_up_suggestions"]}


def _quiz_schema(n):
    from assessments.services.generation import mcq_schema

    return {"type": "object", "properties": {"mcq_questions": mcq_schema(n)}, "required": ["mcq_questions"]}


def _lesson_schema():
    from tutor.services import LESSON_SCHEMA

    return LESSON_SCHEMA


TASKS = {
    "tutor": lambda: ("tutor", TUTOR_SCHEMA, build_user_prompt(
        "Process Management", SOURCE[:2400],
        "Answer the STUDENT QUESTION directly from the SOURCE in about 80-150 words. Set grounded=true only when the answer "
        "comes from the source. Give up to three short follow_up_suggestions.",
        "RECENT CONVERSATION:\n(none)\n", "STUDENT QUESTION:\nWhy does a context switch cost time?\n", trim=False)),
    "quiz": lambda: ("quiz", _quiz_schema(5), build_user_prompt(
        "Process Management", SOURCE,
        "Write exactly 5 multiple-choice questions about the SOURCE TEXT, and nothing else. Each has four options A-D, "
        "exactly one correct, a one-sentence explanation and a short source_reference. Output only the JSON.")),
    "lesson": lambda: ("lesson", _lesson_schema(), build_user_prompt(
        "Process Management", SOURCE,
        "Turn the source into a lesson: two to six learning_objectives, two to eight sections (heading, explanation, "
        "source_reference), key_terms, and a two-sentence summary. Be compact.")),
}


class Command(BaseCommand):
    help = "Benchmark the configured AI provider with fixed prompts: load time, latency, tokens/second per task."

    def add_arguments(self, parser):
        parser.add_argument("--tasks", default="tutor,quiz,lesson", help="Comma-separated subset of: tutor, quiz, lesson.")
        parser.add_argument("--repeat", type=int, default=1, help="Runs per task; the median is reported.")
        parser.add_argument("--json", action="store_true", help="Print one JSON document instead of a table.")

    def handle(self, *args, **options):
        if not settings.AI["ENABLED"]:
            raise CommandError("AI_ENABLED is false; nothing to benchmark.")
        tasks = [t.strip() for t in options["tasks"].split(",") if t.strip()]
        unknown = [t for t in tasks if t not in TASKS]
        if unknown:
            raise CommandError(f"Unknown task(s): {', '.join(unknown)}. Choose from {', '.join(TASKS)}.")

        provider = get_provider()
        report = {"provider": provider.name, "profile": ai_config.describe(), "model": settings.AI.get("MODEL_FILE") or settings.AI["TUTOR_MODEL"],
                  "threads": settings.AI.get("THREADS"), "batch_threads": settings.AI.get("BATCH_THREADS"),
                  "gpu_layers": settings.AI.get("GPU_LAYERS"), "flash_attn": settings.AI.get("FLASH_ATTN"), "tasks": {}}

        started = time.monotonic()
        if hasattr(provider, "warm_up"):
            ok, err = provider.warm_up()
            if not ok:
                raise CommandError(f"Model failed to load: {err}")
        report["load_ms"] = int((time.monotonic() - started) * 1000)
        self._say(f"provider={provider.name} mode={report['profile']['mode']} num_ctx={report['profile']['num_ctx']} load_ms={report['load_ms']}", options)

        gateway = AIGateway(provider)
        for task in tasks:
            task_name, schema, prompt = TASKS[task]()
            runs = []
            for _ in range(max(1, options["repeat"])):
                result = gateway.generate(task=task_name, system_prompt=SYSTEM_PROMPT, user_prompt=prompt,
                                          schema=schema, temperature=0.0, source_chars=len(prompt))
                runs.append({"ok": result.ok, "error": result.error_code, "latency_ms": result.latency_ms,
                             "prompt_tokens": result.prompt_tokens, "generated_tokens": result.completion_tokens,
                             "tokens_per_sec": result.tokens_per_sec, "attempts": result.attempts})
            summary = {
                "runs": runs,
                "ok": all(r["ok"] for r in runs),
                "median_latency_ms": int(statistics.median(r["latency_ms"] for r in runs)),
                "median_tokens_per_sec": statistics.median([r["tokens_per_sec"] for r in runs if r["tokens_per_sec"]] or [0]),
                "prompt_chars": len(prompt) + len(SYSTEM_PROMPT),
                "max_tokens": ai_config.max_tokens_for(task_name),
            }
            report["tasks"][task] = summary
            self._say(f"task={task} ok={summary['ok']} median_latency_ms={summary['median_latency_ms']} "
                      f"prompt_tokens={runs[0]['prompt_tokens']} generated_tokens={runs[0]['generated_tokens']} "
                      f"tokens_per_sec={summary['median_tokens_per_sec']} max_tokens={summary['max_tokens']} prompt_chars={summary['prompt_chars']}", options)
        if options["json"]:
            self.stdout.write(json.dumps(report, indent=2))

    def _say(self, line, options):
        if not options["json"]:
            self.stdout.write(line)
