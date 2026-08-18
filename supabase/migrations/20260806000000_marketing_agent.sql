-- =====================================================================
-- Marketing Agent — schema
-- Phase 0/1: content generation -> human approval -> publish + metrics
-- All tables are INTERNAL/back-office. RLS is enabled with NO public
-- policies, so only the service role (edge functions / cron) can touch
-- them. The anon key ships to clients and must never read/write these.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Brand guide (single source of truth for tone injected into prompts)
-- ---------------------------------------------------------------------
create table if not exists public.marketing_brand_guide (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'OpenMatch',
    -- Short brand voice/positioning summary fed to the LLM every run.
    voice text not null default
        'Warm, modern, trustworthy, anti-manipulation. We are the transparent, AI-first alternative to legacy matrimonial apps. No blurred photos, no forced paywalls.',
    -- Hard rules the model must never break (matrimonial = sensitive).
    banned_topics text[] not null default array[
        'caste-based discrimination',
        'religious superiority',
        'dowry',
        'skin-tone / colourism',
        'guaranteed marriage / results',
        'disparaging named competitors'
    ],
    target_audience text not null default
        'Marriage-minded singles (and their families) 24-38 in India + diaspora, frustrated by paywalls and blurred profiles on Shaadi/Jeevansathi.',
    cta_default text not null default 'Download OpenMatch — free to match & chat.',
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Campaigns (a themed batch of content with a goal + channel set)
-- ---------------------------------------------------------------------
create table if not exists public.marketing_campaigns (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    goal text not null,                       -- e.g. 'installs', 'awareness', 'reactivation'
    channels text[] not null default '{}',    -- e.g. {instagram, reddit, x, email, push}
    status text not null default 'active'
        check (status in ('draft', 'active', 'paused', 'archived')),
    -- Optional spend guardrail for future paid phase (null = organic only).
    budget_cents integer,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Content (every generated post/caption/email — the review queue)
-- ---------------------------------------------------------------------
create table if not exists public.marketing_content (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid references public.marketing_campaigns (id) on delete set null,
    channel text not null,                    -- 'instagram' | 'x' | 'reddit' | 'email' | 'push' | 'linkedin' | ...
    format text not null default 'post',      -- 'post' | 'caption' | 'thread' | 'email' | 'push' | 'ad'
    -- The human-review lifecycle. Nothing publishes until 'approved'.
    status text not null default 'draft'
        check (status in ('draft', 'needs_review', 'approved', 'rejected', 'scheduled', 'published', 'failed')),
    title text,
    body text not null,
    hashtags text[] not null default '{}',
    image_prompt text,                        -- prompt used / to use for a creative
    image_url text,
    -- Moderation / safety flags produced by the agent self-check.
    safety_flags text[] not null default '{}',
    scheduled_at timestamptz,
    published_at timestamptz,
    -- Free-form provider payload / external id after publishing.
    external_ref jsonb not null default '{}'::jsonb,
    reviewer_id uuid references auth.users (id) on delete set null,
    review_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists marketing_content_status_idx
    on public.marketing_content (status);
create index if not exists marketing_content_campaign_idx
    on public.marketing_content (campaign_id);
create index if not exists marketing_content_scheduled_idx
    on public.marketing_content (scheduled_at)
    where status = 'scheduled';

-- ---------------------------------------------------------------------
-- 4. Metrics (per-content engagement, pulled back from the channel)
-- ---------------------------------------------------------------------
create table if not exists public.marketing_metrics (
    id uuid primary key default gen_random_uuid(),
    content_id uuid not null references public.marketing_content (id) on delete cascade,
    captured_at timestamptz not null default now(),
    impressions integer not null default 0,
    clicks integer not null default 0,
    likes integer not null default 0,
    comments integer not null default 0,
    shares integer not null default 0,
    installs integer not null default 0,      -- from attribution provider, when wired
    raw jsonb not null default '{}'::jsonb
);

create index if not exists marketing_metrics_content_idx
    on public.marketing_metrics (content_id);

-- ---------------------------------------------------------------------
-- 5. Agent runs (audit log — every autonomous decision the agent makes)
-- ---------------------------------------------------------------------
create table if not exists public.marketing_agent_runs (
    id uuid primary key default gen_random_uuid(),
    mode text not null,                       -- 'generate' | 'publish' | 'collect_metrics' | 'lifecycle'
    status text not null default 'ok'
        check (status in ('ok', 'partial', 'error', 'dry_run')),
    dry_run boolean not null default false,
    campaign_id uuid references public.marketing_campaigns (id) on delete set null,
    -- Structured summary of what happened (counts, ids, model, errors).
    summary jsonb not null default '{}'::jsonb,
    error text,
    created_at timestamptz not null default now()
);

create index if not exists marketing_agent_runs_created_idx
    on public.marketing_agent_runs (created_at desc);

-- ---------------------------------------------------------------------
-- 6. RLS — enable, add NO policies (service role bypasses RLS).
--    This keeps every table invisible to the anon/authenticated client.
-- ---------------------------------------------------------------------
alter table public.marketing_brand_guide  enable row level security;
alter table public.marketing_campaigns     enable row level security;
alter table public.marketing_content        enable row level security;
alter table public.marketing_metrics        enable row level security;
alter table public.marketing_agent_runs     enable row level security;

-- ---------------------------------------------------------------------
-- 7. Seed a default brand guide + a starter campaign.
-- ---------------------------------------------------------------------
insert into public.marketing_brand_guide (name)
select 'OpenMatch'
where not exists (select 1 from public.marketing_brand_guide);

insert into public.marketing_campaigns (title, goal, channels, status, notes)
select
    'Launch — Organic Awareness',
    'installs',
    array['instagram', 'reddit', 'x', 'email', 'push'],
    'active',
    'Auto-created starter campaign for the marketing agent.'
where not exists (select 1 from public.marketing_campaigns);
