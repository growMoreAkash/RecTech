# syntax=docker/dockerfile:1.7
# DineSense API. Build from the repo root:  docker build -f infra/docker/api.Dockerfile .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@dinesense/api...
# Self-contained production bundle of the API with its workspace deps (shared) copied in.
RUN pnpm deploy --filter=@dinesense/api --prod --legacy /out && cd /out && ./node_modules/.bin/prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD node -e "fetch('http://localhost:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations (non-destructive) then start.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node --enable-source-maps dist/src/main.js"]
