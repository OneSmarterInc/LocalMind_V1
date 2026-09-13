"""Score the monitor against a labelled case file (PRD sections 9 and 15).

    python manage.py monitor_benchmark                       # bundled sample set, validators only
    python manage.py monitor_benchmark --judge               # also call the judge on every case
    python manage.py monitor_benchmark --cases my_cases.jsonl --json

Each line of the JSONL file is one case:

    {"id": "t1", "kind": "tutor_answer", "prompt": "...", "response": "...", "grounded": true,
     "source_reference": "...", "evidence": "reference text", "label": "correct"}
    {"id": "q1", "kind": "quiz", "questions": [...], "evidence": "...", "label": "quiz_error"}

`label` is one of: correct, hallucination, unsupported, irrelevant,
instruction_failure, quiz_error, factual_error, other. Anything but
"correct" counts as a real issue. The command reports precision, recall,
false-positive and false-negative rates, per-label recall, latency, and
which cases were missed, without writing anything to the database.
"""
import json
import time
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai_monitor import judge, services, validators
from ai_monitor.validators import Evidence

SAMPLE = Path(__file__).resolve().parent.parent.parent / "benchmark" / "sample_cases.jsonl"
LABEL_TO_ISSUE = {"hallucination": "hallucination", "unsupported": "unsupported_claim", "irrelevant": "irrelevant",
                  "instruction_failure": "instruction_violation", "quiz_error": "quiz_error", "factual_error": "factual_error", "other": "other"}


class Command(BaseCommand):
    help = "Measure validator/judge precision and recall on a labelled case set."

    def add_arguments(self, parser):
        parser.add_argument("--cases", default=str(SAMPLE))
        parser.add_argument("--judge", action="store_true", help="Call the judge model on every case (needs a working model).")
        parser.add_argument("--json", action="store_true")
        parser.add_argument("--min-confidence", type=float, default=None,
                            help="Treat a verdict as an alert only at or above this confidence (default: the policy defaults).")

    def handle(self, *args, **opts):
        path = Path(opts["cases"])
        if not path.exists():
            raise CommandError(f"{path} not found")
        cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if not cases:
            raise CommandError("No cases in file")
        use_judge = opts["judge"]
        if use_judge and not settings.AI["ENABLED"]:
            raise CommandError("AI is disabled; the judge cannot run. Set AI_ENABLED=true or drop --judge.")
        rows = []
        for case in cases:
            rows.append(self._score(case, use_judge, opts["min_confidence"]))
        report = self._report(rows, use_judge)
        if opts["json"]:
            self.stdout.write(json.dumps(report, indent=2))
            return
        self._print(report)

    def _score(self, case, use_judge, min_conf):
        kind = case.get("kind", "tutor_answer")
        evidence = Evidence([{"kind": "source_text", "ref": "benchmark", "text": case.get("evidence", "")}])
        started = time.monotonic()
        if kind == "quiz":
            checks = validators.run_quiz_checks(questions=case.get("questions", []), evidence=evidence)
            prompt, response = "Generate a quiz.", services._quiz_text(type("A", (), {"title": case.get("title", "Quiz"), "questions": case.get("questions", [])})())
        else:
            checks = validators.run_tutor_checks(prompt=case.get("prompt", ""), response=case.get("response", ""),
                                                 source_reference=case.get("source_reference", ""),
                                                 claimed_grounded=bool(case.get("grounded", True)), evidence=evidence)
            prompt, response = case.get("prompt", ""), case.get("response", "")
        judge_data, judge_failed = None, False
        if use_judge:
            lines = [f"{c.name}: {'pass' if c.passed else 'FAIL' if c.passed is False else 'undecided'} - {c.detail}" for c in checks]
            result = judge.run(kind=kind, prompt=prompt, response=response, evidence_text=evidence.text, validator_lines=lines, metadata={"benchmark": case.get("id")})
            if result.ok:
                judge_data = result.data
            else:
                judge_failed = True
        decision = services.decide(checks, judge_data, judge_failed)
        latency = int((time.monotonic() - started) * 1000)
        threshold = min_conf if min_conf is not None else services.policy_defaults_confidence(decision["issue_type"])
        alert = decision["verdict"] == "issue" and decision["confidence"] >= threshold
        label = case.get("label", "correct")
        actual = label != "correct"
        return {"id": case.get("id"), "kind": kind, "label": label, "expected_issue": LABEL_TO_ISSUE.get(label, "none"),
                "predicted_issue": decision["issue_type"], "verdict": decision["verdict"], "confidence": decision["confidence"],
                "severity": decision["severity"], "alert": alert, "actual": actual, "correct_alert": alert == actual,
                "type_match": (not actual and not alert) or (alert and decision["issue_type"] == LABEL_TO_ISSUE.get(label)),
                "source": decision["source"], "latency_ms": latency, "reason": decision["reason"][:160]}

    def _report(self, rows, use_judge):
        tp = sum(1 for r in rows if r["alert"] and r["actual"])
        fp = sum(1 for r in rows if r["alert"] and not r["actual"])
        fn = sum(1 for r in rows if not r["alert"] and r["actual"])
        tn = sum(1 for r in rows if not r["alert"] and not r["actual"])
        pct = lambda a, b: round(100.0 * a / b, 1) if b else None
        per_label = {}
        for r in rows:
            bucket = per_label.setdefault(r["label"], {"cases": 0, "alerted": 0, "type_match": 0})
            bucket["cases"] += 1
            bucket["alerted"] += r["alert"]
            bucket["type_match"] += r["type_match"]
        return {
            "cases": len(rows), "judge": use_judge, "evaluator_version": services.evaluator_version(),
            "precision_percent": pct(tp, tp + fp), "recall_percent": pct(tp, tp + fn),
            "false_positive_rate_percent": pct(fp, fp + tn), "false_negative_rate_percent": pct(fn, fn + tp),
            "issue_type_accuracy_percent": pct(sum(1 for r in rows if r["type_match"]), len(rows)),
            "median_latency_ms": sorted(r["latency_ms"] for r in rows)[len(rows) // 2],
            "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
            "per_label": per_label,
            "missed": [r for r in rows if not r["correct_alert"]],
            "rows": rows,
        }

    def _print(self, report):
        self.stdout.write(f"AI monitor benchmark: {report['cases']} cases, judge={'on' if report['judge'] else 'off'}, evaluator v{report['evaluator_version']}")
        self.stdout.write(f"  precision {report['precision_percent']}%  recall {report['recall_percent']}%  "
                          f"FPR {report['false_positive_rate_percent']}%  FNR {report['false_negative_rate_percent']}%  "
                          f"issue-type accuracy {report['issue_type_accuracy_percent']}%  median latency {report['median_latency_ms']} ms")
        self.stdout.write(f"  confusion: {report['confusion']}")
        for label, b in report["per_label"].items():
            self.stdout.write(f"  {label:>20}: {b['alerted']}/{b['cases']} alerted, {b['type_match']}/{b['cases']} right type")
        if report["missed"]:
            self.stdout.write(self.style.WARNING(f"  {len(report['missed'])} wrong decision(s):"))
            for r in report["missed"]:
                self.stdout.write(f"    {r['id']}: label={r['label']} predicted={r['predicted_issue']} conf={r['confidence']:.2f} ({r['source']}) - {r['reason']}")
        else:
            self.stdout.write(self.style.SUCCESS("  every case decided correctly"))
