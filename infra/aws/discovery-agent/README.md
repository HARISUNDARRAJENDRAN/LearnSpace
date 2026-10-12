# AWS discovery agent

This boundary deploys the existing `services/ai-backend` FastAPI application
as an x86_64 Lambda container image. The worker remains a separate durable
process: it owns PostgreSQL job leases, calls the throttled API Gateway URL,
validates the response, and persists catalogue resources.

The current deployment contains the bounded Exa/arXiv/YouTube discovery agents
in one Lambda. That keeps the first cloud slice small while preserving the
existing agent contracts; a new agent should only become a separate service
when it needs a different scaling or security boundary.

## Prerequisites

- AWS CLI v2 authenticated to the target account
- Docker with BuildKit and the `--provenance=false` build option
- an IAM principal allowed to use ECR, CloudFormation, Lambda, IAM role
  creation/pass-through, and Secrets Manager
- AWS region `us-east-1`, unless `AWS_REGION` is overridden

The access-key CSV in Downloads is not a project file. Use its credentials only
in the bootstrap process environment. Never copy the CSV into this repository
or put its long-lived keys into GitHub Actions.

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
unique image tag, deploys the CloudFormation template, and prints
the throttled API Gateway URL:

```text
bash infra/aws/discovery-agent/deploy.sh
```

An existing unmanaged container function is imported into the stack before
deployment. The import retains the function identity and does not modify it.
It excludes the old plaintext environment from the import template; the
subsequent deployment replaces that environment with secret ARNs. An import
change set containing anything except resource import is refused.

The default uses the account concurrency quota because this account currently
has only ten concurrent executions and cannot allocate a reservation. The
agent still bounds tool calls and per-instance concurrency; API Gateway has a
five-request-per-second throttle. Set `AWS_RESERVED_CONCURRENCY=2` only after
the account quota has sufficient unreserved capacity. `-1` omits a reservation.

Set `DISCOVERY_AGENT_URL` for the durable worker to the printed URL and set
`INTERNAL_SERVICE_TOKEN` to the same value used for the Secrets Manager
secret. The worker calls `/internal/v1/discovery/refresh`; `/healthz` and
`/readyz` are safe health endpoints, while the refresh route remains protected
by the service token.

## GitHub Actions

The AWS agent is deployed by the `deploy-agent` job in
`.github/workflows/ci.yml`. It runs only by manual dispatch from `main` with
`deploy_staging` enabled, after the foundation, database, and Python jobs pass.
Configure these staging-environment secrets before dispatch:

- `AWS_DISCOVERY_AGENT_ROLE_ARN` — an IAM role trusted by GitHub OIDC
- `AWS_DISCOVERY_AGENT_EXA_API_KEY_SECRET_ARN`
- `AWS_DISCOVERY_AGENT_INTERNAL_TOKEN_SECRET_ARN`
- `STAGING_VERCEL_PROJECT_ID` — must identify the `learnspace-staging` project
- `VERCEL_ORG_ID`, `VERCEL_TOKEN`
- `STAGING_DATABASE_MIGRATOR_URL`, `STAGING_DATABASE_WORKER_URL`
- `STAGING_DISCOVERY_AGENT_URL`, `STAGING_INTERNAL_SERVICE_TOKEN`
- `STAGING_DISCOVERY_SMOKE_EMAIL`, `STAGING_DISCOVERY_SMOKE_PASSWORD`

Set the `STAGING_VERCEL_TEAM_SLUG` and
`STAGING_VERCEL_OIDC_PROVIDER_ARN` variables on the same GitHub environment.
The ARN must identify the pre-provisioned account-level `oidc.vercel.com`
provider with audience `https://vercel.com/<team-slug>`. Keep that shared
provider outside the staging CloudFormation stack so staging teardown cannot
break production trust. The staging project must use Vercel's global OIDC
issuer; its runtime receives only the private-document S3 role scoped to the
staging bucket prefixes.

The workflow uses the same deploy script and never stores the provider key in
GitHub Actions.

With GitHub CLI authenticated as a repository administrator and AWS CLI
authenticated for bootstrap, upload and verify all three identifiers with:

```text
bash infra/aws/discovery-agent/configure-github-secrets.sh
```

`github-oidc-trust.json` binds the deploy role to LearnSpace's immutable owner
and repository IDs on `main`, with audience `sts.amazonaws.com`. This
repository was created after GitHub enabled immutable OIDC subject claims.
The role's `github-deploy-policy.json` scopes deployment to the staging stack,
ECR repository, Lambda, execution role, API Gateway API, and the two secrets.
The runtime role can read only those two Secrets Manager entries.

Lambda finishes provider work and candidate-cache writes before returning,
because Lambda freezes unfinished callbacks after the handler exits. The web
source picker keeps its own 450 ms budget and finalizes late results through
Next.js `after`; the persistent worker owns catalogue writes and learner-state
projection. No heavyweight model runs in the recommendation request path.

After configuration, verify an actual main-branch workflow assumes the role,
deploys the image, and checks build/protocol/schema compatibility. A valid IAM
bootstrap key alone does not verify the GitHub OIDC path.
