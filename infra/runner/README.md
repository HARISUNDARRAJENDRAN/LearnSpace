# Code runner host

Production runs the code runner (`services/runner`) on a VM of its own at
`https://runner.learn-space.app`. The runner drives that host's Docker to
start one sandbox container per execution, and the Docker socket is
root-equivalent, so nothing else runs on this host. Sandboxes run under
gVisor (`SANDBOX_RUNTIME=runsc`) with no network.

| | |
|---|---|
| VM | Azure for Students, resource group `learnspace-runner`, Central India |
| Size | `Standard_B2ats_v2` (2 vCPU, 1 GB RAM, 4 GB swap), Ubuntu 24.04 |
| Address | static IP `20.204.81.82`, A record `runner` on the `learn-space.app` Vercel DNS zone |
| Firewall | NSG `learnspace-runner-nsg`: 80 and 443 from anywhere, 22 from the admin's address only |
| Software | Docker CE and gVisor from their official apt repositories, unattended security upgrades |

One run at a time (`RUNNER_CONCURRENCY=1`) keeps a Java or C++ compile
inside 1 GB of memory. Raise it after resizing the VM (for example to
`Standard_B2als_v2`, 4 GB).

## Files

- `compose.yaml` runs the runner (port 4100, inside the compose network
  only) and Caddy, which gets and renews the TLS certificate and proxies to
  it.
- `Caddyfile` sets the site and a 2 MB request limit.
- `.env`, next to them on the host only (mode 600, never committed), holds
  `RUNNER_TOKEN`, `DATABASE_RUNNER_URL` (the `learnspace_runner` role on the
  transaction pooler, port 6543, `?sslmode=require`), `RUNNER_IMAGE_TAG`,
  `RUNNER_CONCURRENCY`, `RUNNER_QUEUE` and `SANDBOX_CPUS`.

The web app on Vercel has `RUNNER_URL=https://runner.learn-space.app` and
the same `RUNNER_TOKEN`.

## Deploying a new runner

The images are built from a clean checkout and copied over SSH. The VM does
not build them, and no registry is involved.

```text
git archive <commit> | tar -x -C <dir>
docker build --target runner -t learnspace-runner:<commit> <dir>
docker build -t learnspace-sandbox:1 <dir>/services/runner/sandbox   # only when sandbox/ changed
docker save learnspace-runner:<commit> [learnspace-sandbox:1] | gzip -1 | ssh <host> docker load
scp infra/runner/compose.yaml infra/runner/Caddyfile <host>:runner/
ssh <host> 'cd runner && sed -i "s/^RUNNER_IMAGE_TAG=.*/RUNNER_IMAGE_TAG=<commit>/" .env && docker compose up -d'
```

To roll back, set `RUNNER_IMAGE_TAG` to the previous commit (its image is
still loaded) and run `docker compose up -d` again.

## Checking it

```text
curl https://runner.learn-space.app/health                # {"ok":true,"problems":true}
curl -X POST https://runner.learn-space.app/v1/execute    # 401 without the token
ssh <host> 'cd runner && docker compose ps && docker compose logs --tail 50 runner'
```

`problems: true` means the runner can reach the database to grade problems.
