-- Run this once in the Supabase SQL editor before starting the API with
-- DATA_BACKEND=supabase.

create table if not exists public.antirot_installs (
  install_id text primary key,
  token_sha256 text not null,
  migrated_from_local_install_id boolean not null default false,
  created_at_utc timestamptz not null,
  last_seen_at_utc timestamptz not null,
  registration_ip text,
  last_ip text,
  user_agent text,
  client jsonb not null default '{}'::jsonb,
  classify_count integer not null default 0
);

create table if not exists public.antirot_video_classification_cache (
  cache_key text primary key,
  video_url text not null,
  video_id text,
  transcript text not null,
  category integer not null check (category in (0, 1)),
  created_at_utc timestamptz not null,
  updated_at_utc timestamptz not null,
  hit_count integer not null default 0,
  last_hit_at_utc timestamptz
);

create index if not exists idx_antirot_video_cache_video_id
  on public.antirot_video_classification_cache (video_id);

create table if not exists public.antirot_request_events (
  id bigserial primary key,
  event text not null,
  request_id text unique,
  timestamp_utc timestamptz,
  path text,
  client_ip text,
  install_id text,
  install_verified boolean not null default false,
  video_url text,
  video_id text,
  cache_key text,
  category integer,
  success boolean,
  status_code integer,
  error jsonb,
  timings_ms jsonb not null default '{}'::jsonb,
  raw_event jsonb not null
);

create index if not exists idx_antirot_request_events_timestamp
  on public.antirot_request_events (timestamp_utc);
create index if not exists idx_antirot_request_events_event
  on public.antirot_request_events (event);
create index if not exists idx_antirot_request_events_install
  on public.antirot_request_events (install_id);
create index if not exists idx_antirot_request_events_video
  on public.antirot_request_events (video_id);
create index if not exists idx_antirot_request_events_cache_key
  on public.antirot_request_events (cache_key);

alter table public.antirot_installs enable row level security;
alter table public.antirot_video_classification_cache enable row level security;
alter table public.antirot_request_events enable row level security;

revoke all on table public.antirot_installs from anon, authenticated;
revoke all on table public.antirot_video_classification_cache from anon, authenticated;
revoke all on table public.antirot_request_events from anon, authenticated;

grant select, insert, update, delete on table public.antirot_installs to service_role;
grant select, insert, update, delete on table public.antirot_video_classification_cache to service_role;
grant select, insert, update, delete on table public.antirot_request_events to service_role;
grant usage, select on sequence public.antirot_request_events_id_seq to service_role;
