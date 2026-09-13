from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from core.testing import client_for, make_admin, make_student

from . import gateway as gw
from .gateway import AIGateway, OllamaProvider, clean_model_output, trim_source, validate_against_schema


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def chat(content, done_reason="stop"):
    return FakeResponse(200, {"message": {"content": content}, "done_reason": done_reason})


SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}, "points": {"type": "array", "items": {"type": "string"}, "minItems": 1}}, "required": ["answer", "points"]}
AI_ON = {"ENABLED": True, "PROVIDER": "ollama", "OLLAMA_BASE_URL": "http://x", "TUTOR_MODEL": "qwen3:1.7b", "OUTLINE_MODEL": "qwen3:1.7b",
         "TIMEOUT_SECONDS": 5, "NUM_CTX": 16384, "NUM_PREDICT": 4096, "KEEP_ALIVE": "30m", "MAX_RETRIES": 1, "MAX_SOURCE_CHARS": 14000,
         "HEALTH_CACHE_SECONDS": 30}
AI_OFF = dict(AI_ON, ENABLED=False)


class SchemaValidatorTests(TestCase):
    def test_accepts_valid(self):
        self.assertEqual(validate_against_schema({"answer": "a", "points": ["x"]}, SCHEMA), [])

    def test_reports_missing_and_wrong_types(self):
        errors = validate_against_schema({"answer": 3, "points": []}, SCHEMA)
        self.assertTrue(any("expected string" in e for e in errors))
        self.assertTrue(any("at least 1" in e for e in errors))


class OutputCleanupTests(TestCase):
    def test_strips_think_block_and_fence(self):
        raw = '<think>let me reason</think>\n```json\n{"answer": "ok", "points": ["p"]}\n```'
        self.assertEqual(clean_model_output(raw), '{"answer": "ok", "points": ["p"]}')

    def test_unterminated_think_drops_everything_after_it(self):
        self.assertEqual(clean_model_output('{"a": 1}<think>still thinking'), '{"a": 1}')

    def test_leading_prose_before_json_is_removed(self):
        self.assertEqual(clean_model_output('Here is the JSON: {"a": 1}'), '{"a": 1}')

    def test_trim_source_cuts_on_paragraph_boundary(self):
        text = ("para one. " * 30 + "\n\n") * 10
        trimmed = trim_source(text, limit=1000)
        self.assertLessEqual(len(trimmed), 1000)
        self.assertTrue(trimmed.endswith("para one."))

    def test_trim_source_leaves_short_text_alone(self):
        self.assertEqual(trim_source("short", limit=100), "short")


@override_settings(AI=AI_ON)
class GatewayTests(TestCase):
    def _gateway(self):
        return AIGateway(provider=OllamaProvider("http://x"))

    @patch("requests.post")
    def test_valid_output_passes_through(self, post):
        post.return_value = chat('{"answer": "ok", "points": ["p"]}')
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)
        self.assertEqual(result.data["answer"], "ok")
        self.assertEqual(result.attempts, 1)

    @patch("requests.post")
    def test_request_carries_context_window_and_output_cap(self, post):
        post.return_value = chat('{"answer": "ok", "points": ["p"]}')
        self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA, temperature=0.3)
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["model"], "qwen3:1.7b")
        # The window and the output ceiling come from the performance mode and
        # the task, not from one number shared by every call.
        from ai.config import num_ctx, max_tokens_for
        self.assertEqual(body["options"]["num_ctx"], num_ctx())
        self.assertEqual(body["options"]["num_predict"], max_tokens_for("tutor"))
        self.assertEqual(body["options"]["temperature"], 0.3)
        self.assertIs(body["think"], False)
        self.assertEqual(body["format"], SCHEMA)
        self.assertEqual(body["keep_alive"], "30m")
        self.assertEqual(post.call_args.kwargs["timeout"], 5)

    @patch("requests.post")
    def test_think_wrapped_json_is_accepted(self, post):
        post.return_value = chat('<think>hmm</think>{"answer": "ok", "points": ["p"]}')
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)

    @patch("requests.post")
    def test_malformed_then_valid_is_retried_once_at_temperature_zero(self, post):
        post.side_effect = [chat("not json"), chat('{"answer": "ok", "points": ["p"]}')]
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA, temperature=0.7)
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 2)
        second = post.call_args_list[1].kwargs["json"]
        self.assertEqual(second["options"]["temperature"], 0.0)
        self.assertEqual(len(second["messages"]), 3)
        self.assertIn("malformed", second["messages"][2]["content"])

    @patch("requests.post")
    def test_schema_violation_twice_is_rejected(self, post):
        post.side_effect = [chat('{"answer": "ok"}'), chat('{"answer": "ok"}')]
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertFalse(result.ok)
        self.assertEqual(result.error_code, "invalid_schema")
        self.assertEqual(result.attempts, 2)

    @patch("requests.post")
    def test_truncated_output_is_flagged_and_retried(self, post):
        post.side_effect = [chat('{"answer": "ok", "poi', done_reason="length"), chat('{"answer": "ok", "points": ["p"]}')]
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 2)

    @patch("requests.post")
    def test_empty_content_is_reported(self, post):
        post.side_effect = [chat(""), chat("")]
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "empty")

    @patch("requests.post")
    def test_connection_error_is_unavailable_and_not_retried(self, post):
        import requests
        post.side_effect = requests.ConnectionError("refused")
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "unavailable")
        self.assertEqual(post.call_count, 1)

    @patch("requests.post")
    def test_missing_model_gives_pull_hint(self, post):
        post.return_value = FakeResponse(404, {"error": "model not found"})
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "unavailable")
        self.assertIn("ollama pull qwen3:1.7b", result.error)

    @patch("requests.post")
    def test_timeout_is_not_retried(self, post):
        import requests
        post.side_effect = requests.Timeout()
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "timeout")
        self.assertEqual(post.call_count, 1)

    @override_settings(AI=dict(AI_ON, MAX_RETRIES=0))
    @patch("requests.post")
    def test_retries_can_be_disabled(self, post):
        post.return_value = chat("not json")
        result = self._gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
        self.assertEqual(result.error_code, "malformed")
        self.assertEqual(post.call_count, 1)

    def test_disabled_provider_when_ai_off(self):
        with override_settings(AI=AI_OFF):
            result = gw.gateway().generate(task="tutor", system_prompt="s", user_prompt="u", schema=SCHEMA)
            self.assertEqual(result.error_code, "disabled")


class HealthTests(TestCase):
    def setUp(self):
        gw.reset_health_cache()

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_ready_when_reachable_and_model_present(self, get):
        get.return_value = FakeResponse(200, {"models": [{"name": "qwen3:1.7b"}, {"name": "nomic-embed-text:latest"}]})
        status = gw.health(force=True)
        self.assertTrue(status.ready)
        self.assertEqual(status.as_dict()["tutor_model"], {"name": "qwen3:1.7b", "present": True})

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_not_ready_when_model_missing_and_result_is_cached(self, get):
        get.return_value = FakeResponse(200, {"models": [{"name": "llama3:latest"}]})
        first = gw.health(force=True)
        self.assertTrue(first.reachable)
        self.assertFalse(first.ready)
        gw.health()
        self.assertEqual(get.call_count, 1)

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_unreachable(self, get):
        import requests
        get.side_effect = requests.ConnectionError("refused")
        status = gw.health(force=True)
        self.assertFalse(status.reachable)
        self.assertIn("refused", status.error)

    @override_settings(AI=AI_OFF)
    def test_disabled_reports_not_ready_without_network(self):
        status = gw.health(force=True)
        self.assertFalse(status.enabled)
        self.assertFalse(status.ready)

    def test_health_endpoint_includes_ai_block(self):
        data = client_for().get("/api/health/").json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("ready", data["ai"])
        self.assertFalse(data["ai"]["enabled"])  # forced off under the test runner

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_admin_ai_status_endpoint(self, get):
        get.return_value = FakeResponse(200, {"models": [{"name": "qwen3:1.7b"}]})
        resp = client_for(make_admin()).get("/api/admin/ai/status/?refresh=1")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ready"])
        self.assertEqual(client_for(make_student()).get("/api/admin/ai/status/").status_code, 403)


class CheckAICommandTests(TestCase):
    def setUp(self):
        gw.reset_health_cache()

    def _run(self, *args):
        out = StringIO()
        call_command("check_ai", *args, stdout=out)
        return out.getvalue()

    @override_settings(AI=AI_OFF)
    def test_fails_when_disabled(self):
        with self.assertRaises(CommandError):
            self._run()

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_fails_when_unreachable(self, get):
        import requests
        get.side_effect = requests.ConnectionError("refused")
        with self.assertRaises(CommandError):
            self._run()

    @override_settings(AI=AI_ON)
    @patch("requests.get")
    def test_fails_when_model_missing(self, get):
        get.return_value = FakeResponse(200, {"models": []})
        with self.assertRaisesRegex(CommandError, "qwen3:1.7b"):
            self._run()

    @override_settings(AI=AI_ON)
    @patch("requests.post")
    @patch("requests.get")
    def test_pull_then_smoke(self, get, post):
        get.side_effect = [FakeResponse(200, {"models": []}), FakeResponse(200, {"models": [{"name": "qwen3:1.7b"}]})]
        post.side_effect = [FakeResponse(200, {"status": "success"}), chat('{"greeting": "hello", "number": 7}')]
        out = self._run("--pull", "--smoke")
        self.assertIn("pulled qwen3:1.7b", out)
        self.assertIn("AI ready", out)
        self.assertEqual(post.call_args_list[0].args[0], "http://x/api/pull")

    def test_help_text_is_provider_neutral(self):
        from ai.management.commands.check_ai import Command

        self.assertNotIn("Ollama is reachable", Command.help)
        self.assertIn("llama.cpp", Command.help)

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp"))
    @patch("requests.get")
    @patch("requests.post")
    def test_llamacpp_smoke_never_touches_ollama_and_reports_reuse(self, post, get):
        import tempfile
        import types
        from pathlib import Path

        from . import llamacpp

        f = tempfile.NamedTemporaryFile(suffix=".gguf", delete=False)
        f.write(b"GGUF" + b"\0" * 64)
        f.close()
        self.addCleanup(lambda: Path(f.name).unlink(missing_ok=True))
        llamacpp._models.clear()
        self.addCleanup(llamacpp._models.clear)
        gw._provider_cache.clear()
        self.addCleanup(gw._provider_cache.clear)

        loads = []

        class FakeLlama:
            def __init__(self, **kw):
                loads.append(kw)
            def create_chat_completion(self, **kw):
                return {"choices": [{"message": {"content": '{"greeting": "hello", "number": 7}'}, "finish_reason": "stop"}]}

        module = types.ModuleType("llama_cpp")
        module.Llama = FakeLlama
        with patch.dict("sys.modules", {"llama_cpp": module}), patch("ai.llamacpp.MIN_MODEL_BYTES", 4), \
                override_settings(AI=dict(AI_ON, PROVIDER="llamacpp", MODEL_PATH=f.name)):
            out = self._run("--smoke", "--pull")
        self.assertIn("AI provider: llamacpp", out)
        self.assertIn("Mode: embedded/offline", out)
        self.assertIn("--pull does nothing for llamacpp", out)
        self.assertIn("reused across calls", out)
        self.assertIn("AI ready", out)
        self.assertEqual(len(loads), 1)
        get.assert_not_called()
        post.assert_not_called()


class LlamaCppProviderTests(TestCase):
    """The embedded provider is exercised with a stub Llama object so the
    suite never needs the native library or a model file."""

    def _provider(self, tmp_model=True):
        import tempfile
        from pathlib import Path

        from .llamacpp import LlamaCppProvider

        if tmp_model:
            f = tempfile.NamedTemporaryFile(suffix=".gguf", delete=False)
            f.write(b"stub")
            f.close()
            self.addCleanup(lambda: Path(f.name).unlink(missing_ok=True))
            return LlamaCppProvider(Path(f.name))
        return LlamaCppProvider(Path("/nonexistent/model.gguf"))

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp"))
    def test_missing_model_file_reports_unavailable_and_unready_health(self):
        provider = self._provider(tmp_model=False)
        with patch("ai.llamacpp.library_available", return_value=(True, "")):
            result = provider.generate_structured(model="m", messages=[{"role": "system", "content": "s"}], schema=SCHEMA, temperature=0, timeout=2)
            self.assertEqual(result.error_code, "unavailable")
            self.assertIn("fetch_model", result.error)
            reachable, models, error = provider.list_models()
        self.assertFalse(reachable)
        self.assertEqual(models, [])

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp"))
    def test_generates_structured_json_and_marks_truncation(self):
        provider = self._provider()

        class StubLlama:
            def __init__(self):
                self.calls = []
            def create_chat_completion(self, **kw):
                self.calls.append(kw)
                finish = "length" if kw["temperature"] == 0.9 else "stop"
                return {"choices": [{"message": {"content": '{"answer": "ok", "points": ["p"]}'}, "finish_reason": finish}]}

        provider._llm = StubLlama()
        with patch("ai.llamacpp.library_available", return_value=(True, "")), patch("ai.llamacpp.validate_model_file", return_value=(True, "")):
            good = provider.generate_structured(model="m", messages=[{"role": "system", "content": "sys"}, {"role": "user", "content": "u"}],
                                                schema=SCHEMA, temperature=0.0, timeout=2)
            cut = provider.generate_structured(model="m", messages=[{"role": "user", "content": "u"}], schema=SCHEMA, temperature=0.9, timeout=2)
        self.assertTrue(good.ok)
        self.assertEqual(good.data["answer"], "ok")
        self.assertEqual(good.provider, "llamacpp")
        self.assertEqual(cut.error_code, "truncated")
        first = provider._llm.calls[0]
        self.assertEqual(first["response_format"], {"type": "json_object", "schema": SCHEMA})
        self.assertTrue(first["messages"][0]["content"].endswith("/no_think"))
        with patch("ai.llamacpp.library_available", return_value=(True, "")), patch("ai.llamacpp.validate_model_file", return_value=(True, "")):
            reachable, models, _ = provider.list_models()
        self.assertTrue(reachable)
        self.assertIn("qwen3:1.7b", models)

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp"))
    def test_gateway_uses_embedded_provider_and_health_reports_ready(self):
        gw._provider_cache.clear()
        gw.reset_health_cache()
        provider = self._provider()
        provider._llm = object()
        with patch("ai.gateway.get_provider", return_value=provider), patch("ai.llamacpp.library_available", return_value=(True, "")), \
                patch("ai.llamacpp.validate_model_file", return_value=(True, "")):
            status = gw.health(force=True)
            payload = status.as_dict()
        self.assertTrue(status.ready)
        self.assertEqual(status.provider, "llamacpp")
        self.assertEqual(payload["runtime"], "llama.cpp")
        self.assertTrue(payload["details"]["model_file"]["valid"])

    def test_validate_model_file_rejects_missing_small_and_non_gguf(self):
        import tempfile
        from pathlib import Path

        from .llamacpp import validate_model_file, _display_name

        ok, err = validate_model_file(Path("/nonexistent/x.gguf"))
        self.assertFalse(ok); self.assertIn("fetch_model", err)
        small = tempfile.NamedTemporaryFile(suffix=".gguf", delete=False); small.write(b"GGUF" + b"0" * 10); small.close()
        self.addCleanup(lambda: Path(small.name).unlink(missing_ok=True))
        ok, err = validate_model_file(Path(small.name))
        self.assertFalse(ok); self.assertIn("MB", err)
        with patch("ai.llamacpp.MIN_MODEL_BYTES", 4):
            self.assertTrue(validate_model_file(Path(small.name))[0])
            bad = tempfile.NamedTemporaryFile(suffix=".gguf", delete=False); bad.write(b"NOPE" + b"0" * 10); bad.close()
            self.addCleanup(lambda: Path(bad.name).unlink(missing_ok=True))
            ok, err = validate_model_file(Path(bad.name))
            self.assertFalse(ok); self.assertIn("GGUF", err)
        self.assertEqual(_display_name("Qwen3-1.7B-Q4_K_M.gguf"), "Qwen3 1.7B (Q4_K_M)")

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp"))
    def test_system_status_reports_components(self):
        from core.system_health import system_status

        gw._provider_cache.clear(); gw.reset_health_cache()
        report = system_status(force=True)
        names = [c["component"] for c in report["components"]]
        for expected in ("backend", "database", "storage", "ai_runtime", "ai_model", "document_processing", "web_client", "offline_mode"):
            self.assertIn(expected, names)
        by = {c["component"]: c for c in report["components"]}
        self.assertEqual(by["database"]["status"], "READY")
        self.assertEqual(by["storage"]["status"], "READY")
        self.assertEqual(by["ai_model"]["status"], "MISSING")  # no model file in the test environment
        self.assertEqual(by["offline_mode"]["status"], "ERROR")
        self.assertTrue(any("ai model" in b for b in by["offline_mode"]["blockers"]))
        self.assertEqual(report["status"], "ERROR")


class SharedModelLifecycleTests(TestCase):
    """One GGUF instance per process, loaded once, shared by every provider
    and thread, with transient allocation failures retried and permanent
    ones remembered."""

    def setUp(self):
        import tempfile
        from pathlib import Path

        from . import llamacpp

        f = tempfile.NamedTemporaryFile(suffix=".gguf", delete=False)
        f.write(b"GGUF" + b"\0" * 64)
        f.close()
        self.path = Path(f.name)
        self.addCleanup(lambda: self.path.unlink(missing_ok=True))
        self.addCleanup(llamacpp.close_all_models)
        self.addCleanup(llamacpp._models.clear)
        llamacpp._models.clear()

    def _fake_llama_module(self, constructor):
        import types

        module = types.ModuleType("llama_cpp")
        module.Llama = constructor
        return patch.dict("sys.modules", {"llama_cpp": module})

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp"))
    def test_model_is_constructed_once_for_many_providers_and_threads(self):
        import threading

        from .llamacpp import LlamaCppProvider

        constructed = []

        class FakeLlama:
            def __init__(self, **kw):
                constructed.append(kw)
            def create_chat_completion(self, **kw):
                return {"choices": [{"message": {"content": '{"answer": "ok", "points": ["p"]}'}, "finish_reason": "stop"}]}
            def close(self):
                constructed.append("closed")

        with self._fake_llama_module(FakeLlama), patch("ai.llamacpp.MIN_MODEL_BYTES", 4):
            providers = [LlamaCppProvider(self.path) for _ in range(3)]
            results = []

            def call(p):
                results.append(p.generate_structured(model="m", messages=[{"role": "user", "content": "u"}], schema=SCHEMA, temperature=0, timeout=5))

            threads = [threading.Thread(target=call, args=(p,)) for p in providers for _ in range(3)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(len(results), 9)
            self.assertTrue(all(r.ok for r in results))
            self.assertEqual(len([c for c in constructed if c != "closed"]), 1, "model must be loaded exactly once per process")
            self.assertEqual(constructed[0]["n_batch"], 256)
            self.assertEqual(providers[0].describe()["load_count"], 1)
            self.assertIs(providers[0]._llm, providers[2]._llm)
            from .llamacpp import close_all_models, loaded_model_count

            self.assertEqual(loaded_model_count(), 1)
            close_all_models()
            self.assertEqual(loaded_model_count(), 0)
            self.assertIn("closed", constructed)

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp", LOAD_RETRY_SECONDS=0))
    def test_allocation_failure_is_transient_and_retried(self):
        from .llamacpp import LlamaCppProvider

        attempts = []

        class FlakyLlama:
            def __init__(self, **kw):
                attempts.append(1)
                if len(attempts) == 1:
                    raise MemoryError("Unable to allocate 297. MiB for an array with shape (512, 151936)")
            def create_chat_completion(self, **kw):
                return {"choices": [{"message": {"content": '{"answer": "ok", "points": ["p"]}'}, "finish_reason": "stop"}]}

        with self._fake_llama_module(FlakyLlama), patch("ai.llamacpp.MIN_MODEL_BYTES", 4):
            provider = LlamaCppProvider(self.path)
            first = provider.generate_structured(model="m", messages=[{"role": "user", "content": "u"}], schema=SCHEMA, temperature=0, timeout=5)
            self.assertEqual(first.error_code, "unavailable")
            self.assertIn("Unable to allocate", first.error)
            self.assertTrue(provider.describe()["load_error_transient"])
            # Health must not declare the provider dead over a transient failure.
            reachable, _, _ = provider.list_models()
            self.assertTrue(reachable)
            second = provider.generate_structured(model="m", messages=[{"role": "user", "content": "u"}], schema=SCHEMA, temperature=0, timeout=5)
            self.assertTrue(second.ok)
            self.assertEqual(len(attempts), 2)
            self.assertEqual(provider.describe()["load_error"], "")

    @override_settings(AI=dict(AI_ON, PROVIDER="llamacpp", LOAD_RETRY_SECONDS=0))
    def test_permanent_failure_is_not_retried_every_request(self):
        from .llamacpp import LlamaCppProvider

        attempts = []

        class BrokenLlama:
            def __init__(self, **kw):
                attempts.append(1)
                raise RuntimeError("unsupported architecture")

        with self._fake_llama_module(BrokenLlama), patch("ai.llamacpp.MIN_MODEL_BYTES", 4):
            provider = LlamaCppProvider(self.path)
            for _ in range(3):
                result = provider.generate_structured(model="m", messages=[{"role": "user", "content": "u"}], schema=SCHEMA, temperature=0, timeout=5)
                self.assertEqual(result.error_code, "unavailable")
            self.assertEqual(len(attempts), 1)
            reachable, _, error = provider.list_models()
            self.assertFalse(reachable)
            self.assertIn("unsupported architecture", error)
            self.assertIn("unavailable", provider.status_line())
