#!/bin/sh
set -eu

if [ -n "${AWS_LAMBDA_RUNTIME_API:-}" ]; then
  exec python -m awslambdaric lambda_handler.handler
fi

case "${LEARNSPACE_BACKEND_MODE:-api}" in
  api)
    exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
    ;;
  worker)
    exec node /worker/dist/index.js --loop
    ;;
  *)
    echo "LEARNSPACE_BACKEND_MODE must be 'api' or 'worker'." >&2
    exit 64
    ;;
esac
