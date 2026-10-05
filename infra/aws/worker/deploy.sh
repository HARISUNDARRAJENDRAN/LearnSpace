#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?}"
: "${GITHUB_SHA:?}"
: "${WORKER_RUNTIME_SECRET_ARN:?}"
: "${INTERNAL_SERVICE_TOKEN_SECRET_ARN:?}"
: "${DISCOVERY_AGENT_URL:?}"
: "${WORKER_VPC_ID:?}"
: "${WORKER_SUBNET_IDS:?}"

repository=learnspace-worker-staging
stack=learnspace-worker-staging
account="$(aws sts get-caller-identity --query Account --output text)"
registry="$account.dkr.ecr.$AWS_REGION.amazonaws.com"
if ! aws ecr describe-repositories --repository-names "$repository" > /dev/null 2>&1; then
  aws ecr create-repository --repository-name "$repository" --image-tag-mutability IMMUTABLE > /dev/null
fi
aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"
image="$registry/$repository:$GITHUB_SHA"
if ! aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$GITHUB_SHA" > /dev/null 2>&1; then
  docker build --platform linux/amd64 --target worker --tag "$image" .
  docker push "$image"
fi
digest="$(aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$GITHUB_SHA" --query 'imageDetails[0].imageDigest' --output text)"
aws cloudformation deploy --stack-name "$stack" --template-file infra/aws/worker/template.yaml \
  --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
  --parameter-overrides "ImageUri=$registry/$repository@$digest" "BuildSha=$GITHUB_SHA" \
    "RuntimeSecretArn=$WORKER_RUNTIME_SECRET_ARN" "InternalTokenSecretArn=$INTERNAL_SERVICE_TOKEN_SECRET_ARN" \
    "AgentUrl=$DISCOVERY_AGENT_URL" "VpcId=$WORKER_VPC_ID" "SubnetIds=$WORKER_SUBNET_IDS"
aws ecs wait services-stable --cluster "$stack" --services "$stack"
service="$(aws ecs describe-services --cluster "$stack" --services "$stack")"
task_definition="$(echo "$service" | python3 -c 'import json,sys; s=json.load(sys.stdin)["services"][0]; assert s["runningCount"] == 1 and s["pendingCount"] == 0 and len(s["deployments"]) == 1 and s["deployments"][0]["rolloutState"] == "COMPLETED"; print(s["taskDefinition"])')"
aws ecs describe-task-definition --task-definition "$task_definition" --query taskDefinition --output json \
  | python3 -c 'import json,sys; task=json.load(sys.stdin); worker=next(c for c in task["containerDefinitions"] if c["name"] == "worker"); env={v["name"]:v["value"] for v in worker["environment"]}; assert env["WORKER_BUILD_SHA"] == sys.argv[1], "worker is serving another build"; assert worker["image"] == sys.argv[2], "worker image digest does not match"' "$GITHUB_SHA" "$registry/$repository@$digest"
echo "WORKER_VERIFIED build=$GITHUB_SHA running=1 memory=512MiB"
