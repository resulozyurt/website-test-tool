-- Migration 0008: proxy provider settings, switchable from the panel.
--
-- Until now the country proxies came from PROXY_US/PROXY_TR/PROXY_AE, so
-- changing provider meant editing environment variables and redeploying --
-- painful exactly when it matters, which is when a provider's balance or
-- account has just failed. Settings now live here: one active row per country,
-- credentials stored as AES-256-GCM ciphertext (the key stays in
-- SETTINGS_SECRET_KEY), plus the result of the last connectivity test so the
-- panel can show whether a provider actually exits in the right country.
--
-- The environment variables keep working as a fallback when a country has no
-- active row.

create table if not exists proxy_settings (
  id                   serial primary key,
  country              text not null,              -- 'US' | 'AE' | 'TR'
  provider_id          text not null,              -- config/proxy-providers.ts
  label                text,                       -- operator's own note
  credentials          text not null,              -- encrypted blob, never plaintext
  is_active            boolean not null default false,
  last_test_at         timestamptz,
  last_test_ok         boolean,
  last_test_detail     jsonb,                      -- exit ip, exit country, site country
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- At most one active provider per country; the panel switches by flipping it.
create unique index if not exists proxy_settings_active_country_idx
  on proxy_settings (country)
  where is_active;

create index if not exists proxy_settings_country_idx
  on proxy_settings (country, updated_at desc);
