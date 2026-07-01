-- Migration 0005: full-site health crawl.
--
-- A separate lane from the geo-experience sweep. The health crawl visits every
-- active, non-excluded discovered page (per language, through the matching
-- country proxy) and records end-to-end health: technical (HTTP, console,
-- broken resources, blank), visual (broken images, overflow, layout, plus an
-- optional AI visual verdict), and functional (link/CTA target reachability +
-- clickability). These tables never affect the geo-sweep (runs/checks/...);
-- they live alongside it.

create table if not exists health_runs (
  id             serial primary key,
  country        text not null,                       -- 'US' | 'AE' | 'TR' (proxy country)
  trigger        text not null default 'manual',      -- 'manual' | 'cron'
  ai_enabled     boolean not null default false,      -- whether AI visual ran this crawl
  status         text not null default 'running',     -- 'running' | 'pass' | 'warn' | 'fail'
  pages_total    integer not null default 0,
  pages_ok       integer not null default 0,
  pages_warn     integer not null default 0,
  pages_fail     integer not null default 0,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists health_runs_started_idx
  on health_runs (started_at desc);

create table if not exists health_pages (
  id                 serial primary key,
  run_id             integer not null references health_runs(id) on delete cascade,
  discovered_page_id integer references discovered_pages(id) on delete set null,
  url                text not null,
  path               text,
  language           text,
  country            text not null,
  http_status        integer,
  final_url          text,
  blank              boolean not null default false,
  cache_bucket       text,                             -- x-kinsta-cache value seen
  site_country       text,                             -- whereami (site-detected), when available
  console_errors     jsonb,
  network_errors     jsonb,
  broken_images      jsonb,
  broken_links       jsonb,
  ai_verdict         text,                             -- 'match' | 'mismatch' | 'uncertain' | null
  ai_notes           text,
  ai_cost_usd        numeric(10, 6),
  screenshot_key     text,
  status             text not null default 'pass',     -- 'pass' | 'warn' | 'fail' | 'error'
  error              text,
  duration_ms        integer,
  created_at         timestamptz not null default now()
);

create index if not exists health_pages_run_idx
  on health_pages (run_id, status);

create table if not exists health_findings (
  id             serial primary key,
  page_id        integer not null references health_pages(id) on delete cascade,
  category       text not null,                        -- 'technical' | 'visual' | 'functional' | 'location'
  type           text not null,                        -- e.g. 'broken_image', 'console_error', 'cta_target_down'
  severity       text not null,                        -- 'critical' | 'major' | 'minor'
  source         text not null default 'deterministic',-- 'deterministic' | 'ai'
  message        text not null,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists health_findings_page_idx
  on health_findings (page_id, severity);