# AWS discovery deployment verification

Verified on 2026-10-03 in `us-east-1`, AWS account `934685482023`.

## Deployed resources

- CloudFormation: `learnspace-discovery-agent-staging`, updated successfully.
- Existing Lambda retained: `learnspace-discovery-agent-staging`.
- Image build: `aws-bootstrap-20261003-papers`.
- API Gateway: https://n108t7s9vd.execute-api.us-east-1.amazonaws.com
- GitHub OIDC role: `LearnSpaceDiscoveryAgentGitHubDeployRole`.
- Secrets Manager: `learnspace/staging/discovery/exa` and `learnspace/staging/discovery/internal-token`.

The OIDC trust matches this repository's immutable owner/repository IDs and
`main`; its audience is `sts.amazonaws.com`. The runtime role reads only the
two provider/service secrets. AWS IAM Access Analyzer returned zero findings
for the deployment policy. Credentials from Downloads were used in process
environments for bootstrap, never committed or added to GitHub.

The Lambda was imported without replacing its identity or copying its old
plaintext environment into CloudFormation. The account has ten concurrent
executions, so the template omits a reservation by default. API Gateway uses
five requests/second with burst ten; agent tool use remains bounded.

## Verified boundaries

| Boundary | Evidence |
| --- | --- |
| Health/readiness | Both HTTP 200 |
| Internal authentication | Missing service token returns HTTP 401 |
| Version compatibility | `source-discovery-v3`, schema `1`, deployed image build matches |
| Live video discovery | Three YouTube results, one Exa call, no failures |
| Candidate cache | Repeat query returned `cache_hit=true`, zero provider calls |
| Live paper discovery | Three arXiv results, one Exa call, no failures |
| Durable ingestion | Real AWS response persisted ten resources and ten concept relations |
| Authenticated ranking | Smoke learner's populated Home feed generated a run containing all ten ingested resources |

The real-provider smoke used **local PostgreSQL, Redis, and the production
Next.js build** with the live AWS agent. It did not verify the production Neon
database. None of its ten resources were selected into the Home top six:
ingestion makes resources eligible; it does not override relevance or diversity.

## Fixes discovered through verification

1. Lambda cannot rely on callbacks after returning. It now finishes provider
   work and cache writes before returning its response.
2. Exa returned arXiv PDF/HTML links. Valid document URLs now normalize to the
   canonical abstract URL and deduplicate versions/formats. Host, scheme,
   credentials, port, query, fragment, and paper ID validation remain strict.
3. The ingestion smoke incorrectly required every new batch to beat existing
   resources in the top-six feed. It now checks the populated authenticated
   feed and persisted ranking candidates for that exact provider batch.
4. The one-shot smoke held a Redis connection open after completion. Cleanup
   now closes it alongside both database clients.
5. Old browser-test resources were present in the local catalogue. Explicitly
   marked `Browser semantic lesson` fixtures were archived before the live test.

## Measured remote agent timings

These are single HTTP round trips from this workstation, including network and
TLS overhead; they are not recommendation-ranking benchmarks or percentiles.

- Video provider miss: 2,159 ms.
- Video cache hit: 953 ms.
- Paper provider miss after URL fix: 1,889 ms.
- First authenticated version call after deployment: 9,425 ms (cold start).

A temporary workstation DNS failure was bypassed only inside the verification
container using verified DNS results; subsequent direct requests succeeded.

## Automated checks

- Python: 45 tests passed; Ruff and Pyright passed.
- Infrastructure: 10 deployment safety tests passed.
- Both deployment workflows: Actionlint passed.
- Every deployment shell script: Bash syntax passed.
- Worker TypeScript check: passed; twelve unit/integration tests passed.
- Production-build browser E2E: 20 tests passed against local PostgreSQL/Redis.
- Live AWS → durable worker → PostgreSQL → authenticated Home ranking smoke: passed,
  with three real provider calls, no fallback calls, ten ranked resources.
- Docker Compose configuration: passed. Migration container exited successfully;
  five long-running services were healthy/running at approximately 846 MiB total.

## Remaining rollout checks

GitHub CLI authentication is still required to upload the three Actions ARN
secrets using `infra/aws/discovery-agent/configure-github-secrets.sh` and verify
an actual GitHub OIDC deployment. Selecting “I'll authenticate GitHub CLI” does
not grant access until login completes.

Vercel's production environment now contains `DISCOVERY_AGENT_URL` and the
matching sensitive `INTERNAL_SERVICE_TOKEN`. Those values require a new
deployment before they take effect. Production database credentials are
sensitive and were not available through environment pull. The staging smoke
workflow needs its database/test-learner secrets for production persistence
verification. No permanently hosted durable worker was found in this AWS
account; its deployment remains separate from Lambda.
