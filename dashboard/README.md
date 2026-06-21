# website-test-tool dashboard

Read-only web dashboard for the fieldpie.com geo/locale monitoring system.

It reads the same Railway Postgres the runner writes to and never mutates it.
All database access happens in React Server Components, so `DATABASE_URL` never
reaches the browser. The whole dashboard sits behind HTTP Basic Auth.

It deploys as a separate Railway service with the **service root set to
`dashboard/`**, independent of the runner.

## What it shows

- Recent sweeps with colored status badges and per-sweep pass/warn/fail counts.
- A sweep's runs (US / AE / TR × home / pricing) with HTTP status, Kinsta cache
  state, exit vs. site country, and content language.
- Each run's deterministic checks (type, severity, status, expected/actual,
  message) and the advisory AI verdict with its cost.

Screenshots are intentionally not shown yet; persistent storage arrives with
Cloudflare R2 in Phase 5.3.

## Environment

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` — same Postgres connection string the runner uses.
- `DATABASE_SSL` — optional; set to `true` only if the connection needs SSL.
- `DASHBOARD_USER` / `DASHBOARD_PASSWORD` — Basic Auth credentials. If either is
  missing, the dashboard denies every request (fail closed).

## Local development

```bash
cd dashboard
npm install
cp .env.example .env   # then edit .env
npm run dev            # http://localhost:3000
```

`npm run typecheck` runs the TypeScript compiler with no emit.

## Deploy on Railway

Create a new service in the same project, point it at this repo, and set the
**root directory** to `dashboard/`. Railway runs `npm run build` then
`npm start`. Add `DATABASE_URL`, `DASHBOARD_USER`, and `DASHBOARD_PASSWORD` (and
`DATABASE_SSL` if needed) as service variables.
