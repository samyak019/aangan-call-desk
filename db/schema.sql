-- Aangan Studio — Inbound Call Qualification & Lead Handoff
-- Target: Supabase free tier (also runs unchanged on Neon / Render Postgres).
-- Run once in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- calls: one row per phone call the voice agent handled (or missed)
-- ---------------------------------------------------------------------------
create table if not exists calls (
  id                uuid primary key default gen_random_uuid(),
  external_call_id  text unique,                 -- voice platform's id; makes webhook retries idempotent
  caller_phone      text,
  call_timestamp    timestamptz not null,        -- when the call started
  call_ended_at     timestamptz,
  duration_seconds  integer not null default 0,
  raw_transcript    text,
  status            text not null default 'COMPLETED'
                    check (status in ('COMPLETED','MISSED','DROPPED','FAILED')),
  after_hours       boolean not null default false, -- outside 10:00–19:00 IST (front desk hours)
  previous_call_id  uuid references calls(id),   -- same number called within 30 min (dropped-call stitching)
  agent_pricing_leak boolean not null default false, -- guardrail: agent said a ₹ figure the caller didn't
  processed_at      timestamptz,                 -- when classification + handoff finished
  created_at        timestamptz not null default now()
);
create index if not exists calls_phone_idx on calls (caller_phone, call_timestamp desc);
create index if not exists calls_ts_idx on calls (call_timestamp desc);

-- ---------------------------------------------------------------------------
-- leads: structured extraction + qualification outcome for a call
-- ---------------------------------------------------------------------------
create table if not exists leads (
  id                   uuid primary key default gen_random_uuid(),
  call_id              uuid not null unique references calls(id) on delete cascade,
  caller_name          text,
  project_type         text,          -- e.g. "3BHK apartment — full home", "Office fitout"
  location             text,
  carpet_area          integer,       -- sq ft
  timeline             text,
  budget_mentioned     text,          -- only what the caller volunteered; never probed
  qualification_status text not null
                       check (qualification_status in
                         ('QUALIFIED','NOT_QUALIFIED','NEEDS_FOLLOW_UP','ESCALATE',
                          'EXISTING_CLIENT','NOT_AN_ENQUIRY','MISSED')),
  failed_gates         text[] not null default '{}',
  gate_results         jsonb,         -- {scope:{status,reason}, geography:{...}, ...}
  follow_up_question   text,
  asked_for_pricing    boolean not null default false,
  booked_slot          timestamptz,   -- Cal.com booking start, if booked on the call
  handoff_payload      jsonb,         -- the exact message sent + full extraction
  notified_at          timestamptz,
  notify_channel       text,          -- 'telegram' | 'email' | null
  hubspot_deal_id      text,          -- CRM deal created for qualified leads
  created_at           timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (qualification_status, created_at desc);

-- ---------------------------------------------------------------------------
-- system_costs: what each call cost to process.
-- *_cost  = actually billed (USD). 0 while every service stays in its free tier.
-- shadow_* = what the same usage would cost at paid list prices — so Nikhil
--            sees the real unit economics before the free tier runs out.
-- ---------------------------------------------------------------------------
create table if not exists system_costs (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid not null unique references calls(id) on delete cascade,
  stt_cost           numeric(10,5) not null default 0,
  llm_cost           numeric(10,5) not null default 0,
  tts_cost           numeric(10,5) not null default 0,
  total_cost         numeric(10,5) generated always as (stt_cost + llm_cost + tts_cost) stored,
  llm_provider       text,
  llm_input_tokens   integer not null default 0,
  llm_output_tokens  integer not null default 0,
  voice_minutes      numeric(8,2) not null default 0,
  shadow_voice_cost  numeric(10,5) not null default 0,
  shadow_llm_cost    numeric(10,5) not null default 0,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tool_bookings: consultations the voice agent booked mid-call via Cal.com.
-- The post-call webhook joins these back to the call by phone number.
-- ---------------------------------------------------------------------------
create table if not exists tool_bookings (
  id           uuid primary key default gen_random_uuid(),
  caller_phone text,
  slot_start   timestamptz not null,
  calcom_uid   text,
  created_at   timestamptz not null default now()
);
create index if not exists tool_bookings_phone_idx on tool_bookings (caller_phone, created_at desc);
alter table tool_bookings enable row level security;

-- Server code uses the service-role key, which bypasses RLS. Turning RLS on
-- with no policies keeps the anon key (if it ever leaks into a browser) out.
alter table calls        enable row level security;
alter table leads        enable row level security;
alter table system_costs enable row level security;

-- Migration for databases created before the HubSpot step:
alter table leads add column if not exists hubspot_deal_id text;
