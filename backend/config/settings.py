import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url

from .env import BASE_DIR, env_bool, env_int, env_list, env_str

TESTING = "test" in sys.argv[1:2]
PROCESS_DOCUMENTS_INLINE = env_bool("PROCESS_DOCUMENTS_INLINE", False)

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "")
DEBUG = env_bool("DJANGO_DEBUG", False)

if not SECRET_KEY:
    if DEBUG or TESTING:
        SECRET_KEY = "insecure-development-only-secret-key"
    else:
        raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG is false.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
if TESTING:
    ALLOWED_HOSTS.append("testserver")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "core",
    "ai",
    "accounts",
    "academics",
    "audit",
    "documents",
    "learning",
    "assessments",
    "assignments",
    "tutor",
    "activity",
    "analytics",
    "ai_monitor",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves collected static files without nginx so the standalone/offline
    # launcher is a single process.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": dj_database_url.parse(
        env_str("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
    )
}

if DATABASES["default"]["ENGINE"].endswith("sqlite3"):
    # The standalone launcher serves eight waitress threads plus a background
    # document-processing thread from one SQLite file. Three things keep that
    # from surfacing as "database is locked":
    #   * WAL journal: readers never block the writer and vice versa.
    #   * busy timeout (``timeout``): a second writer waits up to this long for
    #     the lock instead of failing immediately.
    #   * IMMEDIATE transactions: every ``transaction.atomic()`` takes the write
    #     lock at BEGIN. With the default DEFERRED mode a transaction that reads
    #     first and writes later must upgrade its lock mid-flight, and SQLite
    #     refuses that upgrade instantly (busy timeout is not consulted) when
    #     another writer got there first. That refusal is the error the admin
    #     screen was showing.
    # Services keep model calls and document parsing outside atomic blocks so
    # the write lock is only ever held for milliseconds.
    DATABASES["default"].setdefault("OPTIONS", {})
    DATABASES["default"]["OPTIONS"].update({
        "timeout": env_int("SQLITE_BUSY_TIMEOUT_SECONDS", 30),
        "transaction_mode": "IMMEDIATE",
        "init_command": (
            "PRAGMA journal_mode=WAL;"
            "PRAGMA synchronous=NORMAL;"
            "PRAGMA temp_store=MEMORY;"
            "PRAGMA cache_size=-32000;"
            "PRAGMA journal_size_limit=67108864;"
        ),
    })

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = env_str("MEDIA_URL", "/media/")
MEDIA_ROOT = Path(env_str("MEDIA_ROOT", str(BASE_DIR / "media"))).resolve()

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Built Expo web client (``npm run export:web`` -> frontend/dist). When the
# folder exists Django serves it at "/", so one process on one port is the
# whole application: API, media, model and UI. Set WEB_DIST to relocate it or
# SERVE_WEB=false to leave the UI to nginx.
WEB_DIST = Path(env_str("WEB_DIST", str(BASE_DIR.parent / "frontend" / "dist"))).resolve()

# Where Django's own admin site lives. Not /admin/: that is the LocalMind
# administrator portal in the web client, and reloading a page there (say
# /admin/users) must load the app, not Django's admin login. Empty turns the
# Django admin site off.
DJANGO_ADMIN_URL = env_str("DJANGO_ADMIN_URL", "django-admin/").strip().strip("/")
DJANGO_ADMIN_URL = f"{DJANGO_ADMIN_URL}/" if DJANGO_ADMIN_URL else ""
if DJANGO_ADMIN_URL.split("/")[0] in ("admin", "api", "media", "static", "student", "manage", "login", "_expo", "assets"):
    raise RuntimeError(f"DJANGO_ADMIN_URL={DJANGO_ADMIN_URL!r} collides with a path the app uses; pick another, e.g. django-admin/.")
SERVE_WEB = env_bool("SERVE_WEB", True) and (WEB_DIST / "index.html").exists()
# Serve /media/ from Django too when there is no reverse proxy in front.
SERVE_MEDIA = env_bool("SERVE_MEDIA", SERVE_WEB)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
        "core.permissions.AccountActive",
        "core.permissions.PasswordChangeCompleted",
    ],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "EXCEPTION_HANDLER": "core.exceptions.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"login": "20/min", "ai": "60/min"},
    # How many reverse proxies sit in front of Django. DRF throttles key on the
    # client address; with this unset DRF trusts the whole X-Forwarded-For
    # header, which any client can write, so the login limit could be dodged
    # by changing that header on every request. 0 (the standalone launcher,
    # no proxy) uses the socket address; 1 (nginx in front, as in deploy/)
    # uses the address nginx appended.
    "NUM_PROXIES": env_int("TRUSTED_PROXY_COUNT", 0),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("ACCESS_TOKEN_MINUTES", 60)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("REFRESH_TOKEN_DAYS", 7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# Live OpenAPI schema and Swagger UI at /api/schema/ and /api/docs/. On in
# development, off in production unless API_DOCS_ENABLED=true.
API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", DEBUG or TESTING)

SPECTACULAR_SETTINGS = {
    "TITLE": "LocalMind API",
    "DESCRIPTION": "Role-based academic learning platform with source-grounded AI tutoring.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/",
    "POSTPROCESSING_HOOKS": ["core.openapi.unique_operation_ids"],
    "TAGS": [{"name": "auth"}, {"name": "admin"}, {"name": "faculty"}, {"name": "student"}],
}

CORS_ALLOWED_ORIGINS = env_list("DJANGO_CORS_ALLOWED_ORIGINS", "http://localhost:8081")
CORS_ALLOW_CREDENTIALS = False

# Origins allowed to POST to the Django admin site and any session-backed view
# when the API sits behind a TLS-terminating proxy (scheme + host, no path).
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "")

if not DEBUG:
    if len(SECRET_KEY) < 32:
        raise RuntimeError("DJANGO_SECRET_KEY must be at least 32 characters when DEBUG is false.")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", True)
    CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", True)
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", False)
    # nginx/Caddy terminate TLS and forward X-Forwarded-Proto; without this
    # Django believes every request is plain http and SECURE_SSL_REDIRECT loops.
    if env_bool("TRUST_PROXY_SSL_HEADER", True):
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # HSTS is off by default because many campus deployments run plain http on
    # a LAN; set to 31536000 once the site is https-only.
    SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
    SECURE_HSTS_PRELOAD = False
    SECURE_REFERRER_POLICY = "same-origin"

DATA_UPLOAD_MAX_MEMORY_SIZE = env_int("MAX_UPLOAD_MB", 100) * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# LocalMind domain settings
LOCALMIND = {
    "MAX_UPLOAD_MB": env_int("MAX_UPLOAD_MB", 100),
    "ALLOWED_UPLOAD_EXTENSIONS": {".pdf", ".docx", ".doc"},
    "INITIAL_USER_PASSWORD": env_str("INITIAL_USER_PASSWORD", "Welcome@LocalMind1"),
    # shared (default): every new account, Excel import row and admin reset
    # starts on INITIAL_USER_PASSWORD and must change it at first login, as the
    # platform always did. unique (opt-in): each gets its own random one-time
    # password, returned once and shown once in the admin screens.
    "INITIAL_PASSWORD_MODE": env_str("INITIAL_PASSWORD_MODE", "shared").strip().lower(),
    # Per-account lockout after repeated failed logins, counted from the audit
    # log so it holds across gunicorn workers and restarts. Keyed by the email
    # typed, so it reveals nothing about whether the account exists.
    # New books: fold textbook boxes ("Questions", "Activity 5.3", "Do You
    # Know?") and modules shorter than OUTLINE_MERGE_MIN_CHARS into the section
    # they belong to, never growing a module past OUTLINE_MERGE_MAX_CHARS.
    "OUTLINE_MERGE_SMALL": env_bool("OUTLINE_MERGE_SMALL", True),
    "OUTLINE_MERGE_MIN_CHARS": env_int("OUTLINE_MERGE_MIN_CHARS", 500),
    "OUTLINE_MERGE_MAX_CHARS": env_int("OUTLINE_MERGE_MAX_CHARS", 16000),
    "LOGIN_MAX_FAILURES": env_int("LOGIN_MAX_FAILURES", 10),
    "LOGIN_LOCKOUT_MINUTES": env_int("LOGIN_LOCKOUT_MINUTES", 15),
    "FACULTY_CAN_PUBLISH": env_bool("FACULTY_CAN_PUBLISH", True),
    "SESSION_HEARTBEAT_TIMEOUT_MINUTES": env_int("SESSION_HEARTBEAT_TIMEOUT_MINUTES", 10),
    "MAX_QUIZ_DURATION_HOURS": env_int("MAX_QUIZ_DURATION_HOURS", 6),
    "DEFAULT_PASS_PERCENTAGE": env_int("DEFAULT_PASS_PERCENTAGE", 65),
    # A document still "processing" after this long is treated as abandoned by
    # a recycled worker and may be claimed again by the next process/ call or
    # by `manage.py requeue_stuck_documents`.
    "PROCESSING_STALE_MINUTES": env_int("PROCESSING_STALE_MINUTES", 30),
}

AI = {
    "ENABLED": env_bool("AI_ENABLED", True) and not TESTING,
    # "llamacpp" runs the model inside this process from a bundled GGUF file
    # (no Ollama, works offline). "ollama" talks to a local Ollama daemon.
    "PROVIDER": env_str("AI_PROVIDER", "llamacpp"),
    # Embedded provider: the GGUF lives at AI_MODEL_PATH, or under
    # backend/models/<AI_MODEL_FILE>. `python manage.py fetch_model` downloads
    # it once; after that nothing needs the internet.
    "MODEL_PATH": env_str("AI_MODEL_PATH", ""),
    "MODEL_FILE": env_str("AI_MODEL_FILE", "Qwen3-1.7B-Q4_K_M.gguf"),
    "MODEL_REPO": env_str("AI_MODEL_REPO", "unsloth/Qwen3-1.7B-GGUF"),
    # Docling layout models for offline PDF parsing (fetch_model --docling).
    "DOCLING_ARTIFACTS": env_str("DOCLING_ARTIFACTS", ""),
    # 0 = all cores but one; set explicitly on shared hosts.
    "THREADS": env_int("AI_THREADS", 0),
    # Layers to offload to a GPU when llama-cpp-python was built with CUDA/Metal.
    "GPU_LAYERS": env_int("AI_GPU_LAYERS", 0),
    # Embedded provider prompt batch size. llama-cpp-python keeps a float32
    # logits buffer of n_batch x vocabulary (152k for qwen3), so 512 costs
    # ~300 MB and 256 ~150 MB; the smaller value was the difference between
    # loading and failing next to the document parser on an 8 GB laptop.
    "BATCH": env_int("AI_BATCH", 256),
    # After a transient load failure (out of memory while the document parser
    # held its models) the embedded provider retries the load after this long.
    "LOAD_RETRY_SECONDS": env_int("AI_LOAD_RETRY_SECONDS", 60),
    "OLLAMA_BASE_URL": env_str("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    # qwen3:1.7b is the production default for every AI feature. The tutor
    # model handles lessons, questions, evaluation and remediation; the
    # outline model runs only during book processing and may be larger.
    "TUTOR_MODEL": env_str("OLLAMA_TUTOR_MODEL", "qwen3:1.7b"),
    "OUTLINE_MODEL": env_str("OLLAMA_OUTLINE_MODEL", "qwen3:1.7b"),
    "TIMEOUT_SECONDS": env_int("OLLAMA_TIMEOUT_SECONDS", 120),
    # Ollama's default context is 4096 tokens, which silently drops the tail
    # of a 12-14k character source prompt. qwen3:1.7b supports 32k; 16k
    # comfortably fits the largest prompt this app sends plus its output.
    "NUM_CTX": env_int("OLLAMA_NUM_CTX", 0),
    # Hard cap on generated tokens so a runaway completion cannot hold a
    # worker for the full timeout. Lessons and 10-question quizzes fit.
    "NUM_PREDICT": env_int("OLLAMA_NUM_PREDICT", 4096),
    # How long Ollama keeps the model resident after a call.
    "KEEP_ALIVE": env_str("OLLAMA_KEEP_ALIVE", "30m"),
    # Small models occasionally emit JSON that misses the schema; one retry
    # at temperature 0 recovers most of those without doubling latency on
    # genuine outages (timeouts and connection errors are never retried).
    "MAX_RETRIES": env_int("OLLAMA_MAX_RETRIES", 1),
    # fast / balanced / quality. The mode sets the context window, the source
    # budget, how much conversation the tutor sees and the per-task token
    # ceilings; ai/config.py holds the table. Every value below overrides its
    # slot in the profile when set, and 0 means "use the profile".
    "PERFORMANCE_MODE": env_str("AI_PERFORMANCE_MODE", "fast"),
    # Character budget for source text embedded in prompts. Roughly 3.5 chars
    # per token for English prose. Unset by default so the mode decides.
    "MAX_SOURCE_CHARS": env_int("AI_MAX_SOURCE_CHARS", 0),
    # How many recent conversation messages the tutor is shown.
    "MAX_CONVERSATION_MESSAGES": env_int("AI_MAX_CONVERSATION_MESSAGES", 0),
    # How many retrieved chunks a tutor answer is built from.
    "RETRIEVAL_CHUNKS": env_int("AI_RETRIEVAL_CHUNKS", 0),
    # Per-task output ceilings; 0 uses the profile.
    "MAX_TOKENS_TUTOR": env_int("AI_TUTOR_MAX_TOKENS", 0),
    "MAX_TOKENS_QUIZ": env_int("AI_QUIZ_MAX_TOKENS", 0),
    "MAX_TOKENS_LESSON": env_int("AI_LESSON_MAX_TOKENS", 0),
    "MAX_TOKENS_REMEDIATION": env_int("AI_REMEDIATION_MAX_TOKENS", 0),
    "MAX_TOKENS_OUTLINE": env_int("AI_OUTLINE_MAX_TOKENS", 0),
    "MAX_TOKENS_EVALUATE": env_int("AI_EVALUATE_MAX_TOKENS", 0),
    "MAX_TOKENS_ASSIGNMENT": env_int("AI_ASSIGNMENT_MAX_TOKENS", 0),
    "MAX_TOKENS_MONITOR": env_int("AI_MONITOR_MAX_TOKENS", 0),
    # Seconds to cache the provider readiness probe used by /api/health/.
    "HEALTH_CACHE_SECONDS": env_int("AI_HEALTH_CACHE_SECONDS", 30),
}

# Lessons are generated in the background (tutor/lessons.py) and read from the
# database, so a student never waits for the model when opening a lesson.
LESSONS = {
    # Queue a lesson for every module when a book is processed and whenever a
    # module's text changes. false: lessons are generated only when faculty
    # press Generate lessons (students see a plain lesson from the text until then).
    "AUTO_GENERATE": env_bool("LESSON_AUTO_GENERATE", True),
    # A reply the model cannot shape into a lesson is retried this many times,
    # with growing gaps, before the module waits for faculty to ask again.
    "MAX_ATTEMPTS": env_int("LESSON_MAX_ATTEMPTS", 3),
    # Base gap before a failed lesson is retried (doubles per attempt, capped at
    # six times this). An unavailable model is retried at this interval forever.
    "RETRY_MINUTES": env_int("LESSON_RETRY_MINUTES", 10),
    # A lesson still "generating" after this long belonged to a process that
    # stopped; another worker may claim it.
    "STALE_MINUTES": env_int("LESSON_STALE_MINUTES", 15),
    # How long the idle worker thread lingers before exiting.
    "IDLE_EXIT_SECONDS": env_int("LESSON_WORKER_IDLE_SECONDS", 30),
    "YIELD_SECONDS": 1.0,
}

# Automatic quizzes (assessments/services/auto_quiz.py): one per module,
# generated in the background after its lesson, published when the module is
# open to students.
AUTO_QUIZ = {
    "ENABLED": env_bool("AUTO_QUIZ_ENABLED", True),
    "MCQS": env_int("AUTO_QUIZ_MCQS", 5),
    "SUBJECTIVE": env_int("AUTO_QUIZ_SUBJECTIVE", 0),
    "PASS_PERCENTAGE": env_int("AUTO_QUIZ_PASS_PERCENTAGE", 65),
    "MAX_ATTEMPTS": env_int("AUTO_QUIZ_MAX_ATTEMPTS", 3),
    # Modules with less text than this (a "Questions" box, a bare heading) get
    # no automatic quiz. 0 gives every module one.
    "MIN_CHARS": env_int("AUTO_QUIZ_MIN_CHARS", 500),
}

# AI Monitoring & Guard: the independent evaluation layer (ai_monitor app).
# Watches every tutor answer and AI-generated quiz, runs deterministic
# validators first, and asks a separate judge model only for suspicious or
# sampled cases. Monitoring failures never block the student-facing path.
AI_MONITOR = {
    # Master switch for the monitor. Off means nothing is evaluated or stored.
    "ENABLED": env_bool("AI_MONITOR_ENABLED", True),
    # async: evaluate on a background thread after the response is sent
    # (production). sync: evaluate inline, used by tests and the backfill
    # command. off: record nothing automatically (manual evaluation only).
    "MODE": env_str("AI_MONITOR_MODE", "sync" if TESTING else "async"),
    # Whether the judge model may be called at all. Validators still run.
    "JUDGE_ENABLED": env_bool("AI_MONITOR_JUDGE_ENABLED", True) and not TESTING,
    # A separate GGUF for the judge (llamacpp provider). Empty means the judge
    # shares the application model, which is the low-memory default. Set
    # AI_MONITOR_MODEL_FILE (under backend/models/) or an absolute
    # AI_MONITOR_MODEL_PATH to use a stronger evaluator such as a 7-8B Qwen
    # instruct model; `python manage.py fetch_model --monitor` downloads it.
    "MODEL_PATH": env_str("AI_MONITOR_MODEL_PATH", ""),
    "MODEL_FILE": env_str("AI_MONITOR_MODEL_FILE", ""),
    "MODEL_REPO": env_str("AI_MONITOR_MODEL_REPO", "Qwen/Qwen2.5-7B-Instruct-GGUF"),
    "MODEL_DOWNLOAD_FILE": env_str("AI_MONITOR_MODEL_DOWNLOAD_FILE", "qwen2.5-7b-instruct-q4_k_m.gguf"),
    # Ollama provider: the tag the judge runs on. Empty = the tutor model.
    "OLLAMA_MODEL": env_str("AI_MONITOR_OLLAMA_MODEL", ""),
    # Percentage of responses that pass every validator and are still sent
    # to the judge, so quiet failures the validators cannot see are sampled.
    "SAMPLE_PERCENT": env_int("AI_MONITOR_SAMPLE_PERCENT", 10),
    # Judge verdicts below this confidence never create an incident on their
    # own (policy rows can raise the bar per issue type, never lower it).
    "MIN_JUDGE_CONFIDENCE": env_int("AI_MONITOR_MIN_JUDGE_CONFIDENCE", 60) / 100,
    # Character cap on the evidence stored with an evaluation and sent to the
    # judge (data minimisation: a bounded excerpt, never a whole conversation).
    "MAX_EVIDENCE_CHARS": env_int("AI_MONITOR_MAX_EVIDENCE_CHARS", 6000),
    # Retrieval depth when rebuilding the reference passages for a tutor answer.
    "EVIDENCE_CHUNKS": env_int("AI_MONITOR_EVIDENCE_CHUNKS", 4),
    # Evaluations and closed incidents older than this are removed by
    # `manage.py monitor_ai --purge` (the maintenance timer runs it).
    "RETENTION_DAYS": env_int("AI_MONITOR_RETENTION_DAYS", 180),
    # Recorded on every evaluation so a verdict can be traced to the logic
    # that produced it. Bump when validators or the judge prompt change.
    "EVALUATOR_VERSION": env_str("AI_MONITOR_EVALUATOR_VERSION", "1.0"),
}

if TESTING:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": env_str("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.request": {"level": "ERROR" if TESTING else "WARNING", "propagate": True},
        "localmind": {"level": env_str("LOG_LEVEL", "INFO"), "propagate": True},
    },
}
