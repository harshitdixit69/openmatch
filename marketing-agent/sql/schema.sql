-- =====================================================================
-- OpenMatch Marketing Agent — schema
-- Standalone repo, but these tables live in the SAME Supabase project as
-- the app so the agent can read `profiles` for lifecycle re-engagement.
-- RLS is enabled with NO public policies -> only the service role (this
-- agent) can touch them; the app's anon/authenticated clients cannot.
--
-- ⚠️ SOURCE OF TRUTH: the canonical schema is the backend migration
--    supabase/migrations/20260806000000_marketing_agent.sql
--    This file is a standalone mirror for `npm run db:push` when the agent
--    is split into its own repo. Keep the two in sync (columns must match:
--    marketing_content.external_ref/published_at and marketing_metrics.*
--    are required by collect-metrics). If in doubt, apply the migration.
-- =====================================================================

create table if not exists public.marketing_brand_guide (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'OpenMatch',
    voice text not null default
        'Warm, modern, trustworthy, anti-manipulation. Transparent AI-first alternative to legacy matrimonial apps. No blurred photos, no forced paywalls.',
    banned_topics text[] not null default array[
        'caste-based discrimination', 'religious superiority', 'dowry',
        'skin-tone / colourism', 'guaranteed marriage / results',
        'disparaging named competitors'
    ],
    target_audience text not null default
        'Marriage-minded singles (and their families) 24-38 in India + diaspora.',
    cta_default text not null default 'Download OpenMatch — free to match & chat.',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.marketing_campaigns (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    goal text not null,
    channels text[] not null default '{}',
    status text not null default 'active'
        check (status in ('draft', 'active', 'paused', 'archived')),
    budget_cents integer,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.marketing_content (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid references public.marketing_campaigns (id) on delete set null,
    channel text not null,
    format text not null default 'post',
    status text not null default 'draft'
        check (status in ('draft', 'needs_review', 'approved', 'rejected', 'scheduled', 'published', 'failed')),
    title text,
    body text not null,
    hashtags text[] not null default '{}',
    image_prompt text,
    image_url text,
    safety_flags text[] not null default '{}',
    scheduled_at timestamptz,
    published_at timestamptz,
    external_ref jsonb not null default '{}'::jsonb,
    review_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists marketing_content_status_idx on public.marketing_content (status);
create index if not exists marketing_content_campaign_idx on public.marketing_content (campaign_id);
create index if not exists marketing_content_scheduled_idx on public.marketing_content (scheduled_at) where status = 'scheduled';

create table if not exists public.marketing_metrics (
    id uuid primary key default gen_random_uuid(),
    content_id uuid not null references public.marketing_content (id) on delete cascade,
    captured_at timestamptz not null default now(),
    impressions integer not null default 0,
    clicks integer not null default 0,
    likes integer not null default 0,
    comments integer not null default 0,
    shares integer not null default 0,
    installs integer not null default 0,
    raw jsonb not null default '{}'::jsonb
);

create index if not exists marketing_metrics_content_idx on public.marketing_metrics (content_id);

create table if not exists public.marketing_agent_runs (
    id uuid primary key default gen_random_uuid(),
    mode text not null,
    status text not null default 'ok'
        check (status in ('ok', 'partial', 'error', 'dry_run')),
    dry_run boolean not null default false,
    campaign_id uuid references public.marketing_campaigns (id) on delete set null,
    summary jsonb not null default '{}'::jsonb,
    error text,
    created_at timestamptz not null default now()
);

create index if not exists marketing_agent_runs_created_idx on public.marketing_agent_runs (created_at desc);

-- RLS: enabled, no public policies (service role bypasses RLS).
alter table public.marketing_brand_guide enable row level security;
alter table public.marketing_campaigns    enable row level security;
alter table public.marketing_content       enable row level security;
alter table public.marketing_metrics       enable row level security;
alter table public.marketing_agent_runs    enable row level security;

-- Seed a default brand guide + starter campaign.
insert into public.marketing_brand_guide (name)
select 'OpenMatch'
where not exists (select 1 from public.marketing_brand_guide);

insert into public.marketing_campaigns (title, goal, channels, status, notes)
select 'Launch — Organic Awareness', 'installs',
       array['instagram', 'reddit', 'x', 'email', 'push'], 'active',
       'Auto-created starter campaign for the marketing agent.'
where not exists (select 1 from public.marketing_campaigns);
