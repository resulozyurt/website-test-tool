#!/bin/sh
# Railway cron entrypoint.
#
# Railway gives a service one schedule, so the split between the daily and the
# weekly job is made here instead of in two services. The service is scheduled
# daily (0 0 * * * UTC); this script decides which pipeline that firing runs:
#
#   every day   -> cron:daily   sweep + healthcheck over the four funnel pages
#                               (home, pricing, demo, free trial) in every
#                               active market, against fixed expectations.
#   FULL_CRAWL_DOW (default 7, Sunday)
#               -> cron:weekly  autopilot (discover, scenarios, manifest,
#                               learn) + a full sweep and crawl over every
#                               page.
#
# Set FULL_CRAWL_DOW to another ISO weekday (1 = Monday ... 7 = Sunday) to move
# the weekly run, or to 0 to disable it.
#
# migrate and seed run inside each pipeline and are hard prerequisites; the
# lanes themselves are guarded so one failing lane never blocks the others.

set -u

DAY_OF_WEEK="$(date -u +%u)"
FULL_DAY="${FULL_CRAWL_DOW:-7}"

if [ "$DAY_OF_WEEK" = "$FULL_DAY" ]; then
  echo "cron: $(date -u +%Y-%m-%dT%H:%M:%SZ) weekday=$DAY_OF_WEEK -> weekly (full) pipeline"
  exec npm run cron:weekly
fi

echo "cron: $(date -u +%Y-%m-%dT%H:%M:%SZ) weekday=$DAY_OF_WEEK -> daily (critical) pipeline"
exec npm run cron:daily
