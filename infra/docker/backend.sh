#!/usr/bin/env bash
# Runs the discovery agent and the discovery worker together. The container
# exits when either process exits so Compose restarts both.
set -uo pipefail

stop() {
  kill -TERM $(jobs -p) 2>/dev/null
  wait
}
trap 'stop; exit 143' TERM INT

uvicorn app.main:app --host 0.0.0.0 --port 8080 &
agent=$!

# The worker calls the agent immediately, so start it once the API answers.
until python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz')" 2>/dev/null; do
  kill -0 "$agent" 2>/dev/null || exit 1
  sleep 1
done

node worker/dist/index.js --loop &

wait -n
status=$?
stop
exit "$status"
