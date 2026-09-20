-- Migration 0006: daily critical-page scope.
--
-- Both lanes now run in one of two scopes. The daily cron checks only the
-- funnel pages (home, pricing, demo, free trial) in every active market; the
-- weekly run still covers the whole inventory. `pages.is_critical` marks the
-- daily set for the geo sweep -- pages added automatically by the scenario
-- reconciler stay false -- and `health_runs.scope` records which scope a crawl
-- ran in, so the dashboard can tell a 12-page daily run from a full one.

alter table pages add column if not exists is_critical boolean not null default false;

update pages
   set is_critical = true
 where page_key in ('home', 'pricing', 'demo', 'free-trial');

alter table health_runs add column if not exists scope text not null default 'full';

create index if not exists pages_critical_idx
  on pages (is_critical)
  where is_critical;

create index if not exists health_runs_scope_idx
  on health_runs (scope, started_at desc);
