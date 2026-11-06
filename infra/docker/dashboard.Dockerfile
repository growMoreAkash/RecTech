# syntax=docker/dockerfile:1.7
# DineSense dashboard (Next.js standalone). Build from the repo root:
#   docker build -f infra/docker/dashboard.Dockerfile --build-arg API_URL=http://api:4000 \
#     --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 .
# Both are baked in at build time: API_URL is where Next proxies /api/v1 (server side),
# NEXT_PUBLIC_API_URL is where browsers open the Socket.IO connection.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
ARG API_URL=http://api:4000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV API_URL=$API_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@dinesense/dashboard...

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
