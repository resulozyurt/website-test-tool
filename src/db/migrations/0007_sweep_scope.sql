-- Migration 0007: record the scope a geo sweep ran in.
--
-- Mirrors health_runs.scope from 0006. 'critical' is the daily funnel run
-- (home, pricing, demo, free trial in every active market); 'full' is the
-- weekly run over every page, including the ones the scenario reconciler
-- added. Existing rows predate the split and were full runs.

alter table sweeps add column if not exists scope text not null default 'full';

create index if not exists sweeps_scope_idx
  on sweeps (scope, started_at desc);
