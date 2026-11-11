# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

WORKDIR /workspace

RUN npm install --global pnpm@11.24.0

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/runner/package.json services/runner/package.json
COPY services/worker/package.json services/worker/package.json

RUN --mount=type=cache,id=learnspace-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM dependencies AS source

COPY . .

FROM base AS worker-build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/worker/package.json services/worker/package.json
RUN --mount=type=cache,id=learnspace-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @learnspace/worker... --filter learnspace
COPY packages/shared ./packages/shared
COPY services/worker ./services/worker
COPY apps/web/public/data/learnspace_youtube_curriculum_master.csv ./apps/web/public/data/learnspace_youtube_curriculum_master.csv

RUN pnpm --filter "@learnspace/worker..." run build \
    && pnpm --filter @learnspace/worker deploy --prod --legacy --config.allowUnusedPatches=true /worker-runtime

# The discovery worker: Exa and YouTube discovery, quality scoring and recommendation upkeep.
FROM node:${NODE_VERSION}-bookworm-slim AS backend

ENV NODE_ENV=production \
    CURRICULUM_PATH=/service/worker/data/curriculum.csv

WORKDIR /service

COPY --from=worker-build --chown=node:node /worker-runtime ./worker
COPY --from=worker-build /workspace/apps/web/public/data/learnspace_youtube_curriculum_master.csv ./worker/data/curriculum.csv

USER node

CMD ["node", "worker/dist/index.js", "--loop"]

# A production web image contains Next's traced runtime, public assets and nothing from the build toolchain.
FROM source AS web-build

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @learnspace/shared build \
    && pnpm --filter @learnspace/db build \
    && pnpm --filter @learnspace/web build

FROM node:${NODE_VERSION}-bookworm-slim AS web-production

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    MALLOC_ARENA_MAX=2 \
    NODE_OPTIONS=--max-old-space-size=384

WORKDIR /service
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# Compose uses this target for the local web container. It keeps the source
# tree and migration tooling available for Next.js.
FROM source AS development

EXPOSE 3000

CMD ["pnpm", "--filter", "@learnspace/web", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
