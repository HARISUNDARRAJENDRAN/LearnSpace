# AWS discovery deployment verification

Verified on 2026-10-03 in `us-east-1`, AWS account `934685482023`.

## Deployed resources

- CloudFormation: `learnspace-discovery-agent-staging`, updated successfully.
- Existing Lambda retained: `learnspace-discovery-agent-staging`.
- Image build: `a8c74e69364007bae0181043512d605f503d0bbc` (verified GitHub OIDC deployment).
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

The real-provider smoke passed both with **local PostgreSQL/Redis and the
production Next.js build**, and subsequently with **the hosted staging database
and Vercel application**. Both runs persisted ten real resources and evaluated
all ten in an authenticated Home ranking run. None were selected into the Home
top six: ingestion makes resources eligible; it does not override relevance or
diversity.

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
- GitHub CI: 93 web tests and four shared-package tests passed.
- Production-build browser E2E: 20 tests passed against local PostgreSQL/Redis.
- Live AWS → durable worker → PostgreSQL → authenticated Home ranking smoke: passed,
  with three real provider calls, no fallback calls, ten ranked resources.
- Docker Compose configuration: passed. Migration container exited successfully;
  five long-running services were healthy/running at approximately 846 MiB total.

## Completed rollout

- All three GitHub Actions ARN secrets were uploaded and verified by name:
  `AWS_DISCOVERY_AGENT_ROLE_ARN`, `AWS_DISCOVERY_AGENT_EXA_API_KEY_SECRET_ARN`,
  and `AWS_DISCOVERY_AGENT_INTERNAL_TOKEN_SECRET_ARN`.
- The staging agent URL and matching internal token secrets were updated for
  the hosted smoke workflow. Provider keys remain in AWS Secrets Manager.
- [Main CI](https://github.com/HARISUNDARRAJENDRAN/LearnSpace/actions/runs/37132755848)
  passed. Its AWS step skipped because the secrets were added after that run
  was queued; the subsequent deployment below verified the real OIDC path.
- [GitHub OIDC agent deployment](https://github.com/HARISUNDARRAJENDRAN/LearnSpace/actions/runs/37133121763)
  passed, including the scoped-role CloudFormation update and exact build,
  protocol, and schema checks.
- [Hosted staging discovery smoke](https://github.com/HARISUNDARRAJENDRAN/LearnSpace/actions/runs/37133194047)
  passed with three live provider calls, ten persisted resources, ten concept
  links, and ten ranked resources in the authenticated Vercel Home response.
- Vercel deployment `dpl_CEYW5CFJ7W1nYNtMeZLhCGQX8KrL` is `READY`, serving
  https://learnspace-staging.vercel.app with the AWS URL and matching token.
- Hosted health and login returned HTTP 200; unauthenticated Home and Discover
  APIs returned HTTP 401.

## Remaining operational scope

No permanently hosted durable worker was found in this AWS account. The
existing scheduled staging smoke runs a transient worker, and the local
Compose worker remains running. Continuous cloud worker hosting is a separate
deployment from the Lambda agent; the verified hosted smoke demonstrates the
existing worker/database/web contract, not a newly deployed always-on worker.
The browser suite ran against the production build locally; hosted verification
covered authenticated API/database/provider boundaries rather than every
browser journey against the public deployment.
