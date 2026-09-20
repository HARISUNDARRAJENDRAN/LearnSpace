#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
stage="${LEARNSPACE_STAGE:-staging}"
stack_name="${AWS_STACK_NAME:-learnspace-discovery-agent-${stage}}"
function_name="${AWS_FUNCTION_NAME:-learnspace-discovery-agent-${stage}}"
repository="${AWS_ECR_REPOSITORY:-learnspace-discovery-agent-${stage}}"
image_tag="${IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required to build the Lambda image" >&2; exit 1; }

: "${EXA_API_KEY_SECRET_ARN:?Set EXA_API_KEY_SECRET_ARN before deploying}"
: "${INTERNAL_SERVICE_TOKEN_SECRET_ARN:?Set INTERNAL_SERVICE_TOKEN_SECRET_ARN before deploying}"

if [[ ! "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "IMAGE_TAG must be a valid ECR tag" >&2
  exit 1
fi

account_id="$(aws sts get-caller-identity --query Account --output text)"
registry="${account_id}.dkr.ecr.${region}.amazonaws.com"

if ! aws ecr describe-repositories \
  --repository-names "$repository" \
  --region "$region" \
  >/dev/null 2>&1; then
  aws ecr create-repository \
    --repository-name "$repository" \
    --image-scanning-configuration scanOnPush=true \
    --region "$region" \
    >/dev/null
fi

image_uri="${registry}/${repository}:${image_tag}"
aws ecr get-login-password --region "$region" \
  | docker login --username AWS --password-stdin "$registry" >/dev/null

docker build \
  --platform linux/amd64 \
  -f services/ai-backend/Dockerfile.lambda \
  -t "$image_uri" \
  services/ai-backend
docker push "$image_uri" >/dev/null

aws cloudformation deploy \
  --template-file infra/aws/discovery-agent/template.yaml \
  --stack-name "$stack_name" \
  --region "$region" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "FunctionName=${function_name}" \
    "ImageUri=${image_uri}" \
    "EnvironmentName=${stage}" \
    "BuildSha=${image_tag}" \
    "ExaApiKeySecretArn=${EXA_API_KEY_SECRET_ARN}" \
    "InternalServiceTokenSecretArn=${INTERNAL_SERVICE_TOKEN_SECRET_ARN}" \
  --no-fail-on-empty-changeset

agent_url="$(aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$region" \
  --query 'Stacks[0].Outputs[?OutputKey==`AgentUrl`].OutputValue | [0]' \
  --output text)"

printf 'Discovery agent deployed behind API Gateway: %s\n' "$agent_url"
