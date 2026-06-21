-- Migration 0002: page discovery inventory.
--
-- Raw output of the sitemap/crawl discovery step: "what URLs exist on the
-- site". This is intentionally separate from the runner's logical `pages`
-- table. Reconciliation into logical test pages (grouping language variants
-- via the manifest) happens in a later step; this table never affects what the
-- sweep tests on its own.

create table if not exists discovered_pages (
  id             serial primary key,
  url            text not null unique,                -- canonical absolute URL (no query/hash)
  path           text not null,                       -- pathname only
  language       text not null default 'en',          -- best-effort from path prefix
  slug           text,                                -- last non-language path segment (null => home)
  source         text not null default 'sitemap',     -- 'sitemap' | 'crawl'
  is_excluded    boolean not null default false,      -- blog/other, excluded from testing
  exclude_reason text,                                 -- why excluded (e.g. 'blog')
  is_active      boolean not null default true,        -- seen in the latest discovery run
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create index if not exists discovered_pages_active_idx
  on discovered_pages (is_active, is_excluded);
