# AWS discovery agent

This boundary deploys the existing `services/ai-backend` FastAPI application
as an x86_64 Lambda container image. The worker remains a separate durable
process: it owns PostgreSQL job leases, calls this Function URL, validates the
response, and persists catalogue resources.

The current deployment contains the bounded Exa/arXiv/YouTube discovery agents
in one Lambda. That keeps the first cloud slice small while preserving the
existing agent contracts; a new agent should only become a separate service
when it needs a different scaling or security boundary.

## Prerequisites

- AWS CLI v2 authenticated to the target account
- Docker 20.10.10 or newer
- an IAM principal allowed to use ECR, CloudFormation, Lambda, IAM role
  creation/pass-through, and Secrets Manager
- AWS region `us-east-1`, unless `AWS_REGION` is overridden

The access-key CSV in Downloads is not a project file. If it is used for the
initial local bootstrap, import it into the AWS CLI credential store and never
copy it into this repository:

```text
aws configure import --csv file:///home/hxsundr/Downloads/Harisundar-iam_accessKeys.csv
```

Prefer short-lived credentials or GitHub OIDC for ongoing deployments, and
rotate the long-lived IAM key after the bootstrap if it is no longer needed.

## Provision provider secrets

Secrets are JSON objects in AWS Secrets Manager. The Lambda reads them at cold
start; neither value is present in the CloudFormation template or image.

```text
export AWS_REGION=us-east-1
export EXA_API_KEY='set-this-in-your-shell-only'
export INTERNAL_SERVICE_TOKEN='set-the-same-token-used-by-the-worker'
bash infra/aws/discovery-agent/bootstrap-secrets.sh
```

The script updates or creates these secret names by default:

- `learnspace/staging/discovery/exa` with `EXA_API_KEY`
- `learnspace/staging/discovery/internal-token` with `INTERNAL_SERVICE_TOKEN`

It prints only the resulting ARNs. Export them for the deployment command:

```text
export EXA_API_KEY_SECRET_ARN='arn:aws:secretsmanager:...'
export INTERNAL_SERVICE_TOKEN_SECRET_ARN='arn:aws:secretsmanager:...'
```

## Deploy

The script creates the ECR repository when needed, builds and pushes a
unique image tag, deploys the SAM template through CloudFormation, and prints
the Function URL:

```text
bash infra/aws/discovery-agent/deploy.sh
```

Set `DISCOVERY_AGENT_URL` for the durable worker to the printed URL and set
`INTERNAL_SERVICE_TOKEN` to the same value used for the Secrets Manager
secret. The worker calls `/internal/v1/discovery/refresh`; `/healthz` and
`/readyz` are safe health endpoints, while the refresh route remains protected
by the service token.

## GitHub Actions

`.github/workflows/discovery-agent-deploy.yml` is manual by design. Configure
these repository secrets, then run it from the Actions tab:

- `AWS_DISCOVERY_AGENT_ROLE_ARN` — an IAM role trusted by GitHub OIDC
- `AWS_DISCOVERY_AGENT_EXA_API_KEY_SECRET_ARN`
- `AWS_DISCOVERY_AGENT_INTERNAL_TOKEN_SECRET_ARN`

The workflow uses the same deploy script and never stores the provider key in
GitHub Actions.
