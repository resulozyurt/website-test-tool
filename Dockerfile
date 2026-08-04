# Runner image — geo sweep + full-site health crawl.
#
# These are BATCH JOBS, not a web server: the container runs a command, does its
# work against the live site through country proxies, writes to Postgres, then
# exits. Railway's restart policy is NEVER (see railway.json) so a clean exit is
# not treated as a crash, and Phase 2 will attach a 12h cron schedule.
#
# Playwright's official image ships Chromium plus every OS dependency at the
# pinned version, so there is no `playwright install` step and no browser
# download at build time. Keep this tag in sync with the `playwright` version in
# package.json (currently 1.49.1).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Install dependencies first for better layer caching. --include=dev is required
# because the app runs TypeScript directly via `tsx` (a devDependency); Railway
# may set NODE_ENV=production during build, which would otherwise skip it.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Copy the runner source. dashboard/, node_modules and generated *-output/
# folders are excluded via .dockerignore to keep the image small.
COPY . .

ENV NODE_ENV=production

# Default job: apply migrations, upsert config from targets.ts, then run one geo
# sweep so the dashboard has data. All three steps are idempotent. Overridden by
# railway.json's startCommand (kept identical here as a fallback).
CMD ["sh", "-c", "npm run migrate && npm run seed && npm run sweep"]
