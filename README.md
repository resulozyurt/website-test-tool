# website-test-tool

Independent geo/locale monitoring and testing system for **fieldpie.com**.

It runs as a separate service and never modifies the site under test. It visits
the site like a real user from different countries, verifies business rules
(correct CTA, price visibility, country-specific heading and phone, language)
and technical health (HTTP status, console errors, cache correctness), stores
results, and emails an alert when something breaks.

---

## Phase 0 — verification harness (this commit)

Before building the full system, Phase 0 proves the core assumption on the live
site: that routing through a country-targeted proxy produces the correct
geo-located experience and that the cache serves different content per country.

The harness in `src/` does exactly this for the US, AE, and TR markets:

- Visits the site through a per-country residential proxy (sticky session).
- Reads cache and locale headers (`x-kinsta-cache`, `cf-cache-status`,
  `content-language`).
- Extracts content markers (html `lang`, CTA buttons, currency symbols, phone
  numbers, Turkish-text detection).
- Takes a full-page screenshot per country.
- Flags the **silent fallback to Turkish** failure (a non-TR market serving
  Turkish content).
- Flags **missing cache differentiation** (all countries returning identical
  content).

This is a throwaway proof, not the production system. It produces evidence we
review before Phase 1.

### Prerequisites

- Node.js 20+
- A pay-as-you-go residential proxy account with sticky sessions and
  country targeting for US, AE, and TR.

### Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Then edit .env and paste one proxy URL per country (PROXY_US / PROXY_AE / PROXY_TR).
```

### Run

```bash
npm run poc
```

Output:

- `poc-output/report.json` — full structured results.
- `poc-output/US.png`, `AE.png`, `TR.png` — full-page screenshots.
- A summary table printed to the console.

---

## Roadmap

- **Phase 0** — verification harness (current).
- **Phase 1** — foundations (repo structure, types, config, database, storage).
- **Phase 2** — production lane runner (deterministic checks, non-submitting
  interactions, passive security hygiene).
- **Phase 3** — WordPress manifest reader (read-only, secret-protected).
- **Phase 4** — AI validation, page scenario engine, email alerts.
- **Phase 5** — staging lane (full end-to-end, real form submission), dashboard,
  scheduling, retention, hardening.
