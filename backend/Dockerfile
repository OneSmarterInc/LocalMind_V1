# LocalMind API image. docling pulls PyTorch, so the image is a few GB; that
# is the cost of local, offline document parsing and is expected.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --home /app localmind
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu

COPY --chown=localmind:localmind . .
RUN mkdir -p /app/media /app/staticfiles && chown -R localmind:localmind /app
USER localmind

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD curl -fsS http://127.0.0.1:8000/api/health/ || exit 1

# migrate + collectstatic run in the entrypoint so a fresh container is usable;
# check_ai gates on the configured AI provider being ready (embedded GGUF present, or Ollama with models pulled).
COPY --chown=localmind:localmind deploy-entrypoint.sh /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
# One worker: each gunicorn worker is a process with its own copy of the model
# (about 1.8 GB with its context), and the lesson pre-warm queue, the AI
# monitor queue and the tutor answer cache live in that process. Threads carry
# the concurrency; model calls are serialised by the provider lock anyway.
# Raise GUNICORN_WORKERS only on a host with RAM for another model copy.
ENV GUNICORN_WORKERS=1 GUNICORN_THREADS=8
CMD ["sh", "-c", "exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} --timeout 300"]
