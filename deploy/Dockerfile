# NOT at repo root — Railway auto-detects a root Dockerfile and ignores railway.toml's
# nixpacks builder + startCommand (next start). ECS/Fargate builds use this file.
# Requires `output: "standalone"` in next.config.mjs.
#
# Build:  docker build -f deploy/Dockerfile -t blackout-web .
# Run:    docker run --rm -p 3000:3000 -e PORT=3000 blackout-web
# Health: GET /api/ready (same as Railway)

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build does not need live Postgres/Redis — schema is created at runtime on first dbQuery().
# NEXT_PUBLIC_* must be present at build time (inlined into client bundles).
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ARG NEXT_PUBLIC_SITE_URL="https://staging.blackouttrades.com"
ARG NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS="https://staging.blackouttrades.com"
ARG NEXT_PUBLIC_CLERK_IS_SATELLITE="true"
ARG NEXT_PUBLIC_CLERK_PROXY_URL="https://staging.blackouttrades.com/__clerk"
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL="https://blackouttrades.com/sign-in"
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL="https://blackouttrades.com/sign-up"
ARG GITHUB_SHA=""
ENV NODE_ENV=production
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS=$NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS
ENV NEXT_PUBLIC_CLERK_IS_SATELLITE=$NEXT_PUBLIC_CLERK_IS_SATELLITE
ENV NEXT_PUBLIC_CLERK_PROXY_URL=$NEXT_PUBLIC_CLERK_PROXY_URL
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV GITHUB_SHA=$GITHUB_SHA
ENV CF_PURGE_DEPLOY_ID=$GITHUB_SHA
RUN npm run build

FROM base AS runner
ARG GITHUB_SHA=""
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GITHUB_SHA=$GITHUB_SHA
ENV CF_PURGE_DEPLOY_ID=$GITHUB_SHA
# Railway uses 8080 internally; ECS task def can set PORT to match ALB target.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/migrations ./src/lib/migrations

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
