#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
stage="${LEARNSPACE_STAGE:-staging}"
repository="${GH_REPO:-HARISUNDARRAJENDRAN/LearnSpace}"
role_name="${AWS_DISCOVERY_DEPLOY_ROLE_NAME:-LearnSpaceDiscoveryAgentGitHubDeployRole}"
prefix="${LEARNSPACE_SECRET_PREFIX:-learnspace/${stage}/discovery}"

gh auth status --hostname github.com >/dev/null
role_arn="$(aws iam get-role --role-name "$role_name" --query Role.Arn --output text)"
exa_arn="$(aws secretsmanager describe-secret --secret-id "${prefix}/exa" --region "$region" --query ARN --output text)"
token_arn="$(aws secretsmanager describe-secret --secret-id "${prefix}/internal-token" --region "$region" --query ARN --output text)"

# Only identifiers enter GitHub; provider credentials stay in Secrets Manager.
printf '%s' "$role_arn" | gh secret set AWS_DISCOVERY_AGENT_ROLE_ARN --repo "$repository"
printf '%s' "$exa_arn" | gh secret set AWS_DISCOVERY_AGENT_EXA_API_KEY_SECRET_ARN --repo "$repository"
printf '%s' "$token_arn" | gh secret set AWS_DISCOVERY_AGENT_INTERNAL_TOKEN_SECRET_ARN --repo "$repository"
gh secret list --repo "$repository" --json name --jq '.[].name | select(startswith("AWS_DISCOVERY_AGENT_"))'
