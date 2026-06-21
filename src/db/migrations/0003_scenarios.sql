-- Migration 0003: generated per-country visibility scenarios.
--
-- One row per (page, country, element, expectation). Produced from the page
-- inventory (Bricks conditions) by the scenario generator. The runner verifies
-- each active scenario in the live DOM per country. Money-critical scenarios
-- (prices, billing, pricing CTAs) are flagged for severity/alerting.

create table if not exists scenarios (
  id                serial primary key,
  page_post_id      integer not null,            -- WP post id (language-specific page)
  page_url          text not null,
  language          text not null,
  page_slug         text,
  country           text not null,               -- 'US' | 'AE' | 'TR'
  element_id        text not null,               -- Bricks element id
  selector          text not null,               -- '.brxe-<element_id>'
  kind              text not null,               -- button | text | heading | ...
  label             text,                         -- human-readable, for the dashboard
  expectation       text not null,               -- 'present' | 'absent'
  rule              text not null,                -- provenance, e.g. '!= TR'
  inherited         boolean not null default false,
  is_money_critical boolean not null default false,
  gating            boolean not null default true,
  active            boolean not null default true, -- present in the latest generation
  checksum          text,
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (page_post_id, country, element_id, expectation)
);

create index if not exists scenarios_active_idx on scenarios (active, country);
create index if not exists scenarios_page_idx   on scenarios (page_post_id, country);
