-- Migration 0009: email alerting.
--
-- The suite has been catching problems and telling no one: somebody had to
-- open the panel to find out. Two tables fix that.
--
-- alert_settings is a single row holding the SMTP account, the recipients and
-- the noise policy. The SMTP password is stored encrypted, like proxy
-- credentials, with the key still in SETTINGS_SECRET_KEY.
--
-- alert_state is what keeps the mail useful. Without it, a problem that
-- persists for a week would produce an identical email every run until nobody
-- reads them any more. One row per distinct problem records when it was first
-- seen and when it was last reported, so a new problem is sent immediately, an
-- ongoing one is repeated at most once per renotify window, and a problem that
-- disappears produces a single recovery note.

create table if not exists alert_settings (
  id              integer primary key default 1,
  enabled         boolean not null default false,
  from_address    text,
  recipients      text[] not null default '{}',
  min_severity    text not null default 'major',        -- 'critical' | 'major'
  renotify_hours  integer not null default 24,
  smtp_host       text not null default 'smtp.gmail.com',
  smtp_port       integer not null default 465,
  credentials     text,                                  -- encrypted { password }
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  updated_at      timestamptz not null default now(),
  constraint alert_settings_singleton check (id = 1)
);

insert into alert_settings (id) values (1) on conflict (id) do nothing;

create table if not exists alert_state (
  fingerprint      text primary key,      -- lane:country:page:finding_type
  lane             text not null,         -- 'health' | 'sweep'
  country          text,
  page_key         text,
  finding_type     text not null,
  severity         text not null,         -- 'critical' | 'major'
  status           text not null default 'open',   -- 'open' | 'resolved'
  detail           text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_notified_at timestamptz,
  notify_count     integer not null default 0
);

create index if not exists alert_state_open_idx
  on alert_state (status, last_seen_at desc);
