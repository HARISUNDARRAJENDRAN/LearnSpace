#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
stage="${LEARNSPACE_STAGE:-staging}"
prefix="${LEARNSPACE_SECRET_PREFIX:-learnspace/${stage}/discovery}"
exa_secret_id="${EXA_API_KEY_SECRET_ID:-${prefix}/exa}"
token_secret_id="${INTERNAL_SERVICE_TOKEN_SECRET_ID:-${prefix}/internal-token}"

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

: "${EXA_API_KEY:?Set EXA_API_KEY in the environment before bootstrapping secrets}"
: "${INTERNAL_SERVICE_TOKEN:?Set INTERNAL_SERVICE_TOKEN in the environment before bootstrapping secrets}"

put_json_secret() {
  local secret_id="$1"
  local json_key="$2"
  local value="$3"
  local description="$4"
  local secret_file
  secret_file="$(mktemp)"
  chmod 600 "$secret_file"
  trap 'rm -f -- "$secret_file"' EXIT

  SECRET_JSON_KEY="$json_key" SECRET_JSON_VALUE="$value" python3 -c '
import json
import os
import sys

json.dump(
    {os.environ["SECRET_JSON_KEY"]: os.environ["SECRET_JSON_VALUE"]},
    sys.stdout,
)
' >"$secret_file"

  if aws secretsmanager describe-secret \
    --secret-id "$secret_id" \
    --region "$region" \
    >/dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --secret-id "$secret_id" \
      --secret-string "file://$secret_file" \
      --region "$region" \
      >/dev/null
  else
    aws secretsmanager create-secret \
      --name "$secret_id" \
      --description "$description" \
      --secret-string "file://$secret_file" \
      --region "$region" \
      >/dev/null
  fi
  rm -f -- "$secret_file"
  trap - EXIT
}

put_json_secret \
  "$exa_secret_id" \
  EXA_API_KEY \
  "$EXA_API_KEY" \
  "LearnSpace ${stage} discovery provider credential"
put_json_secret \
  "$token_secret_id" \
  INTERNAL_SERVICE_TOKEN \
  "$INTERNAL_SERVICE_TOKEN" \
  "LearnSpace ${stage} discovery worker authentication token"

exa_arn="$(aws secretsmanager describe-secret --secret-id "$exa_secret_id" --region "$region" --query ARN --output text)"
token_arn="$(aws secretsmanager describe-secret --secret-id "$token_secret_id" --region "$region" --query ARN --output text)"

printf 'EXA_API_KEY_SECRET_ARN=%s\n' "$exa_arn"
printf 'INTERNAL_SERVICE_TOKEN_SECRET_ARN=%s\n' "$token_arn"
