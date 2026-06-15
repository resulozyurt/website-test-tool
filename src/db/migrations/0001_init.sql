-- Migration 0001: initial schema.

create table if not exists environments (
  id         serial primary key,
  key        text not null unique,          -- 'production' | 'staging'
  base_url   text not null default '',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists markets (
  id           serial primary key,
  country_code text not null,               -- 'US' | 'AE' | 'TR'
  language     text not null,               -- 'en' | 'tr' | ...
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (country_code, language)
);

create table if not exists pages (
  id               serial primary key,
  page_key         text not null unique,    -- 'home' | 'pricing' | ...
  path_by_language jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists expectations (
  id         serial primary key,
  market_id  integer not null references markets(id) on delete cascade,
  page_id    integer not null references pages(id) on delete cascade,
  source     text not null default 'manual',   -- 'manifest' | 'manual'
  payload    jsonb not null default '{}'::jsonb,
  checksum   text,
  updated_at timestamptz not null default now(),
  unique (market_id, page_id)
);

create table if not exists sweeps (
  id             serial primary key,
  environment_id integer not null references environments(id),
  trigger        text not null default 'cron',    -- 'cron' | 'manual'
  status         text not null default 'running', -- 'running'|'pass'|'warn'|'fail'
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create table if not exists runs (
  id               serial primary key,
  sweep_id         integer not null references sweeps(id) on delete cascade,
  market_id        integer not null references markets(id),
  page_id          integer not null references pages(id),
  proxy_country    text,
  exit_ip          text,
  exit_country     text,
  http_status      integer,
  kinsta_cache     text,
  cf_cache_status  text,
  content_language text,
  status           text not null default 'error',  -- 'pass'|'warn'|'fail'|'error'
  screenshot_key   text,
  html_key         text,
  raw_headers      jsonb,
  console_errors   jsonb,
  network_errors   jsonb,
  error            text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create table if not exists checks (
  id         serial primary key,
  run_id     integer not null references runs(id) on delete cascade,
  type       text not null,
  severity   text not null,        -- 'critical'|'major'|'minor'
  status     text not null,        -- 'pass'|'warn'|'fail'
  expected   text,
  actual     text,
  message    text not null default '',
  evidence   jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_verdicts (
  id            serial primary key,
  run_id        integer not null references runs(id) on delete cascade,
  model         text not null,
  verdict       text not null,     -- 'match'|'mismatch'|'uncertain'
  confidence    real,
  findings      jsonb,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10,5),
  created_at    timestamptz not null default now()
);

create table if not exists alerts (
  id         serial primary key,
  sweep_id   integer references sweeps(id) on delete cascade,
  run_id     integer references runs(id) on delete cascade,
  channel    text not null default 'email',
  severity   text not null,
  subject    text,
  body       text,
  delivered  boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_runs_sweep on runs(sweep_id);
create index if not exists idx_checks_run on checks(run_id);
create index if not exists idx_sweeps_started on sweeps(started_at desc);