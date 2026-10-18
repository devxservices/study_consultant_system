# One image definition, two targets: the API and the web app.
# Built from the repository root:  docker compose -f deploy/docker-compose.yml build
# (docker-compose.yml already points here; you rarely run this by hand.)

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY . .
# The web app's /api proxy target is fixed when it is built.
ARG API_URL=http://api:4000
ENV API_URL=${API_URL}
RUN npm run build:shared \
 && npm run build --workspace @crm/api \
 && npm run build --workspace @crm/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Uploaded files (a volume in docker-compose.yml) and the mail outbox.
RUN mkdir -p /app/storage /app/.data && chown node:node /app/storage /app/.data
USER node

# The API applies any new database migrations, then starts. Migrations only
# ever add; running them on every start is safe.
FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node dist/db/scripts/migrate.js && exec node dist/main.js"]

FROM runtime AS web
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/sign-in').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "-p", "3000"]
