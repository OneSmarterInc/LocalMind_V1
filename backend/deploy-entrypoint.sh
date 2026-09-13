#!/bin/sh
set -e
cd /app
python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null
if [ "${AI_ENABLED:-true}" = "true" ]; then
  # llamacpp: verifies and pre-loads the bundled model. ollama: waits for the
  # daemon and pulls the models on a fresh host.
  n=0
  until python manage.py check_ai --pull; do
    n=$((n+1)); [ "$n" -ge 20 ] && { echo "Ollama not ready after 20 attempts"; exit 1; }
    sleep 15
  done
fi
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
  python manage.py bootstrap_admin --email "$BOOTSTRAP_ADMIN_EMAIL" || true
fi
exec "$@"
