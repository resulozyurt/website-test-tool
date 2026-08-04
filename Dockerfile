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

# Default job (Phase 2 — 12h cron): the full monitoring pipeline.
#   migrate + seed (idempotent prerequisites) ->
#   autopilot (discover + learn, best-effort) ->
#   sweep (geo lane, best-effort) ->
#   healthcheck (full-site crawl, best-effort)
# autopilot/sweep/healthcheck are each guarded with `|| true` (see the "cron"
# script) so one lane failing never blocks the others. Railway invokes this on
# the service's Cron Schedule (0 0 * * * — daily at 00:00 UTC); restartPolicyType is NEVER so the
# container exits cleanly after each run.
CMD ["sh", "-c", "npm run cron"]
