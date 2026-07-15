# System Instructions for Copilot / Claude
**Context:** You are an expert Full-Stack Engineer and iOS Mobile Architect. We are building "OpenMatch" (working title), a modern, highly affordable matrimonial platform designed to disrupt incumbent apps (like Shaadi.com) by eliminating aggressive paywalls and providing an AI-first, user-centric experience natively on iPhone.
**Goal:** Use this document as the master blueprint. Read it to understand the architecture, database schema, AI workflows, and step-by-step implementation guide. 

---

# 1. Project Overview & Philosophy
**Problem:** Traditional matrimonial apps use "extortion-based" monetization (locking features, blurring faces, spamming notifications) and charge exorbitant monthly subscription fees.
**Solution:** OpenMatch uses an **"AI Escrow" Freemium Model**. Users can browse, match, and chat for free under AI moderation (which blocks contact info/PII). Once trust is established, users pay a small *micro-transaction* (e.g., $1 or ₹99) to unlock unmoderated chat and share contact info.
**Core AI Features:**
1.  **Compatibility Snapshots:** AI summarizes *why* two people match instead of blurring profiles.
2.  **AI Escrow Chat:** Free chat with semantic filtering to prevent PII/phone number sharing until paid.
3.  **Tone Analyzer:** AI detects if the profile is "Self-managed" or "Parent-managed".
4.  **Intent Escrow:** AI slows down bulk requests by forcing a real reason, optional voice/video proof of intent, and response commitments before the sender can fan out more interests.

---

# 2. Tech Stack Recommendations
* **Frontend (iOS Mobile):** React Native (Expo) optimized for iOS, utilizing native navigation, safe area view structures, and Expo Apple Authentication.
* **Backend / Database:** Supabase (PostgreSQL with `pgvector` for semantic matching, Auth, Row Level Security).
* **AI / LLM:** OpenAI API (GPT-4o-mini for fast, cheap escrow chat moderation) or Anthropic Claude 3 Haiku.
* **Realtime Intent Layer:** Groq for low-latency request coaching, spam detection, ghost-risk scoring, and follow-up nudges.
* **Audio Intelligence:** Deepgram Nova or Whisper for voice intro transcription and quality checks.
* **Video Trust Layer:** Mux for short selfie-video capture/playback plus FaceTec or AWS Rekognition Face Liveness for proof that a real person recorded the clip.
* **Automated AI Calls:** Retell AI or Vapi on top of Twilio, used only as an optional re-engagement or scheduling layer for high-intent matches, not as the default first touch.
* **Payments:** Stripe (Payment Intents for micro-transactions, with Apple Pay support enabled).
* **Hosting:** Vercel (Next.js backend APIs), Supabase Edge Functions (for webhook/AI triggers).

---

# 3. Database Schema (Supabase / Postgres)
This is the foundational SQL schema for the database layer. Use this to derive all frontend TypeScript/JavaScript data models.

```sql
-- 1. Enable the pgvector extension (keeps it future-ready for our AI matching phase)
create extension if not exists vector;

-- 2. Create Custom Enums for our application logic
create type profile_owner_type as enum ('self', 'parent', 'sibling', 'relative');
create type match_status_type as enum ('pending', 'connected', 'rejected');

-- 3. PROFILES TABLE
-- Extends the default Supabase auth.users table
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  gender text not null,
  dob date not null,
  location text not null,
  bio text,
  profile_owner profile_owner_type default 'self',
  
  -- This column will hold the AI embeddings later. For now, it can remain null.
  embedding vector(1536), 
  
  is_verified boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. MATCHES TABLE
-- Tracks the state of a match and whether it has been unlocked via a micro-transaction
create table public.matches (
  id uuid default gen_random_uuid() primary key,
  user_1_id uuid references public.profiles(id) on delete cascade not null,
  user_2_id uuid references public.profiles(id) on delete cascade not null,
  status match_status_type default 'pending' not null,
  
  -- The core monetization pillar: defaults to false. 
  -- Paid micro-transaction flips this to true, bypassing future chat restrictions.
  is_unlocked boolean default false not null,
  
  -- This will hold the automated AI matchmaker summary later. For now, blank.
  ai_compatibility_summary text,
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Prevent duplicate rows for the same pair of users
  unique(user_1_id, user_2_id),
  constraint check_user_order check (user_1_id < user_2_id)
);

-- 5. MESSAGES TABLE
-- Handles the real-time chat data
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  match_id uuid references public.matches(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  content text not null,
  
  -- For Phase 2, a regex or system flag can mark a message as containing sensitive PII
  is_flagged_by_system boolean default false not null,
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Enable Row Level Security (RLS) on all tables for ironclad security
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;

-- 7. RLS Policies (Basic examples for Copilot to expand upon)
create policy "Allow public read access to profiles" on public.profiles
  for select using (true);

create policy "Allow users to update their own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "Allow users to view their own matches" on public.matches
  for select using (auth.uid() = user_1_id or auth.uid() = user_2_id);

create policy "Allow participants to view match messages" on public.messages
  for select using (
    exists (
      select 1 from public.matches 
      where id = messages.match_id 
      and (user_1_id = auth.uid() or user_2_id = auth.uid())
    )
  );

---

# 4. Core AI Workflows & System Prompts

## Workflow 1: AI Escrow Chat (PII Blocking)
**Trigger:** Before inserting a new row into the `messages` table, trigger an Edge Function that runs the message through a fast LLM.
**System Prompt:**
> You are a privacy filter for a matrimonial app. Your job is to analyze the following message and detect if the user is trying to share Personal Identifiable Information (PII) like phone numbers, WhatsApp numbers, email addresses, Instagram handles, or exact addresses. 
> If PII is detected, respond ONLY with a JSON object: {"is_pii": true, "redacted_message": "[The message with PII removed and replaced with '<Updgrade to share contact info>']"}
> If no PII is detected, respond ONLY with: {"is_pii": false, "redacted_message": "[Original message]"}

## Workflow 2: Smart Compatibility Snapshot
**Trigger:** When User A views User B's profile, fetch both bios and send to LLM.
**System Prompt:**
> You are an expert matchmaker. Read Profile A and Profile B. Generate a 2-sentence summary highlighting why they are a good match based on shared interests, career alignment, or lifestyle. Be positive but realistic. 
> Format: "You both [shared trait], and [complementary trait]."

---

# 5. Step-by-Step Implementation Guide

## Phase 1: Project Setup & Authentication
1.  **Initialize Project:** Run `npx create-expo-app openmatch` and `npx create-next-app web-backend`. [**Implemented**]
2.  **Supabase Setup:** Create a Supabase project. Execute the SQL schema (Profiles, Matches, Messages) and enable `pgvector`. [**Implemented**]
3.  **Authentication:** Implement Supabase Auth (Email/Password & OTP) along with Sign-In with Apple (`expo-apple-authentication`). Build the native iOS login/signup layout wrappers. [**Implemented**]

## Phase 2: Onboarding & Vector Embeddings
1.  **Profile Creation Form:** Build a multi-step iOS form using a flat lists/scroll view with native KeyboardAvoidingView handles (Name, DOB, Height, Bio, Preferences). [**Implemented**]
2.  **Edge Function (Embedding):** When a `profile` is inserted/updated, trigger a Supabase Database Webhook to an Edge Function. [**Implemented**]
3.  **OpenAI Integration:** The Edge Function calls `openai.embeddings.create` using the user's bio + preferences, and saves the vector back to the `profiles.embedding` column. [**Implemented**]

## Phase 3: Semantic Matchmaking Feed
1.  **Postgres Function:** Create a Postgres function `match_profiles` that takes a user's embedding and uses cosine distance (`<=>`) to find top 20 similar profiles.
2.  **Feed UI:** Build an iOS card-swipe fluid list view using React Native PanResponder or Reanimated. 
3.  **Compatibility Snapshot API:** When a user taps a profile, call an API that generates and caches the AI compatibility summary.

## Phase 4: The Escrow Chat
1.  **Chat UI:** Implement real-time chat using Supabase Realtime subscriptions inside a layout optimized for iOS Dynamic Islands and bottom home indicators.
2.  **Message Interceptor:** When a user hits "Send", call a Next.js API route first.
3.  **AI Moderation:** The API route runs the 'PII Blocking' prompt. If `is_pii` is false, insert into Supabase. If true, insert the `redacted_message` and trigger an in-app notification: *"To share contact details, please unlock this match."*

## Phase 5: Micro-Transaction Paywall (The Fair Monetization)
1.  **Stripe Setup:** Integrate `@stripe/stripe-react-native` configured with Apple Pay entitlements. 
2.  **Unlock UI:** Add a stylized, native iOS Apple Pay style mutual unlock block at the top of the chat screen. One user requests contact exchange, the other accepts, and then both pay the same amount.
3.  **Payment Flow:** 
  * User A clicks `Request contact exchange`.
  * User B accepts the request.
  * Backend creates one Stripe PaymentIntent per participant after both have accepted.
  * On successful webhook confirmations for both users, update `matches.is_unlocked = true`.
4.  **Chat Rules Update:** Once `is_unlocked` is true, the UI skips the Phase 4 AI Interceptor and allows direct messaging and PII sharing. Until then, the chat stays in AI escrow mode.

## Phase 6: Reference-Inspired UX Polish & Conversion Flows
This phase captures the most important UI and product surfaces visible in the reference app video, but should be implemented in a way that still preserves OpenMatch's fair-pay, AI-escrow philosophy instead of copying abusive paywall patterns.
Current workspace status is marked inline as **Implemented**, **Partial**, or **Planned**.
Current footer scope for the next build keeps **Home** and **Premium** visible in the footer as inactive placeholders, while **Matches**, **Inbox**, and **Chat** are the only active tabs.

1.  **Bottom Navigation Footer:** Build a polished bottom footer inspired by the reference. Keep **Home** and **Premium** visible for visual parity, but leave them inactive for now. The active product flow should center on Matches, Inbox, and Chat: Matches should show profile suggestions ranked against user preferences and active filters, Inbox should show incoming requests sent by other users, and Chat should show the conversations between matched users. **Current repo:** Partial. Badge-aware footer wiring exists and Home/Premium can remain as placeholders, but the final visual treatment still needs to be aligned to the reference footer.
2.  **Top Utility Layer:** Add the high-frequency top-bar controls shown in the reference flow, including a menu entry, notification badge, and lightweight utility actions that stay consistent across Matches, Inbox, and Chat. **Current repo:** Implemented. A shared utility strip now appears across Matches, Inbox, and Chat with menu/alerts placeholders and a refresh action.
3.  **Matches Discovery Toolbar:** Expand the Matches screen with a search field plus segmented chips like New and Daily so users can quickly move through prioritized candidate buckets. **Current repo:** Implemented. Search plus count-led New and Daily chips are present, alongside supporting filters like With photos and Nearby.
4.  **Loading Skeletons & Recovery States:** Add polished skeleton placeholders for Matches, Inbox, and Chat, along with empty states and recovery CTAs such as refresh, view accepted matches, and swipe/contact prompts. **Current repo:** Partial. Empty states and refresh actions exist, and baseline skeleton placeholders now cover feed, inbox list, and message loading, but deeper shimmer/polish variants are still pending.
5.  **Full Match Detail Experience:** Upgrade the profile detail view into a long-form scroll experience with dedicated sections for Photo Album, Basic Details, Family Details, Career & Education, and any additional structured matrimonial profile data. **Current repo:** Implemented.
6.  **Primary Match Actions:** Keep the high-intent action bar at the bottom of the profile detail flow with actions in the spirit of Super Connect, View Contact, and Connect Now, adapted to OpenMatch's own product rules. **Current repo:** Partial. The bottom action row exists, but it does not yet mirror the richer trio from the reference app.
7.  **Contact Details Preview Card:** Show a dedicated contact details card inside the profile flow with masked phone/email states and a clear CTA to view or unlock contact access only when allowed by the mutual unlock rules. **Current repo:** Partial. Contact details storage and unlocked call/WhatsApp actions exist, but not the dedicated masked contact preview card in the match profile flow.
8.  **Compatibility Snapshot & Preference Fit:** Add a stronger compatibility section that visually explains why two people match, including a checklist-style summary such as "You match X/Y preferences" with check, mismatch, or partial-fit indicators. **Current repo:** Implemented.
9.  **Common Ground Insights:** Add a concise "common between both of you" section that highlights overlaps such as diet, education, religion/community, city, lifestyle, or astro-related compatibility hooks. **Current repo:** Implemented.
10. **Inbox Information Architecture:** Strengthen Inbox with category tabs for Received, Accepted, Contacts, and Sent so match state is obvious before the user opens a thread. **Current repo:** Implemented.
11. **Accepted-State Subfilters:** Inside Accepted, add fast subfilters like Accepted by Her and Accepted by Me so the user can distinguish inbound momentum from outbound interest. **Current repo:** Planned.
12. **Accepted Card Quick Actions:** For accepted or unlocked cards, support prominent quick actions like in-app chat, WhatsApp, and call, while continuing to respect AI escrow and unlock gating where required. **Current repo:** Implemented. Accepted/unlocked inbox cards now expose prominent Open Chat plus Call/WhatsApp actions, while locked accepted cards route users to unlock-first flow.
13. **Chat List Filters:** Add top-level chat filters similar to All, Unread, Shaadi Live-style priority buckets, and any call/contact-oriented buckets that help users triage active conversations faster. **Current repo:** Partial. Inbox tabs plus All and Unread are present, but the broader priority buckets are not.
14. **Unread & Live Status Signals:** Keep unread badges, updating-list affordances, and other lightweight live-state signals visible in the chat and inbox surfaces so the product feels active and responsive. **Current repo:** Partial. Unread counts and seen state exist, but the fuller live-status treatment from the reference app is still missing.
15. **Premium/VIP Promotion Surfaces:** Add optional premium promo cards and highlighted premium profile treatments in discovery or inbox surfaces, but avoid coercive monetization and keep the core chat/match journey usable for free users. **Current repo:** Partial. Non-coercive premium promo cards now exist in Matches and Inbox surfaces, highlighted premium profile treatments are visible on discovery and Inbox match cards, baseline premium analytics instrumentation tracks impressions/CTA/highlight interactions, conversion-targeted promo variants adapt messaging using prior engagement and impression cooldowns, deterministic A/B bucketing now personalizes promo copy by experiment arm with arm-tagged tracking metadata, and the Premium tab analytics snapshot includes by-surface and by-arm CTR readouts. Remaining work is deeper experimentation strategy and richer reporting dashboards.
16. **Implementation Rule:** Treat this phase as a product-polish and information-architecture pass layered on top of the existing AI matching, escrow chat, and mutual unlock systems, not as a replacement for them. **Current repo:** Implemented as a guiding constraint.

## Phase 7: Anti-Ghosting Intent Escrow & Trust Layer
This phase directly targets the most frustrating Shaadi.com behavior: profiles, especially parent-managed ones, spraying bulk interests and then disappearing after the other side accepts. The goal is to make outgoing interest requests expensive in intent, cheap in effort for serious users, and measurable over time.

### Product Rule
An interest request is no longer just a tap. It becomes a lightweight intent artifact with a personalized reason, optional voice or selfie proof, an acceptance SLA, and reliability scoring. OpenMatch should reward serious follow-through and throttle users who repeatedly trigger silent dead ends.

### Recommended AI Stack
1.  **Groq:** Primary low-latency request coach. Use it to generate personalized request reasons, score generic bulk outreach, classify ghost-risk, and draft polite follow-up nudges.
2.  **Deepgram Nova:** Preferred production speech-to-text for 15-30 second voice intros because latency matters in the send-request flow. Keep Whisper as a fallback or offline batch option.
3.  **Mux + Face Liveness:** Use Mux for short selfie-video upload and playback. Pair it with FaceTec or AWS Rekognition Face Liveness if the product later needs higher-trust recorded intent verification.
4.  **Retell AI or Vapi on Twilio:** Optional escalation only for high-intent matches. Use this after acceptance to confirm whether the sender still wants to proceed or to schedule a real call. Do not use automated calls as the first interaction.

### User-Facing Screens
1.  **Connect Composer Sheet:** Before sending an interest, show AI-generated reasons such as "Both families are based in Pune and both profiles prioritize career stability." The sender must select, edit, or record a short voice note.
2.  **Incoming Request Card:** In Inbox and Chat, show the personalized reason, sender trust badge, response-rate badge, and optional voice-intro play button.
3.  **Trust & Reliability Drawer:** Show metrics like response rate, average first reply time, open requests count, and whether the profile is self-managed or parent-managed.
4.  **Voice Intro Recorder:** Lightweight screen for a 15-30 second voice note. Trigger this after repeated ghosting or when a low-trust sender exceeds their open-request allowance.
5.  **Selfie Intent Clip Screen:** Optional 10-20 second selfie video capture for premium trust or repeated ghost-risk accounts.
6.  **Post-Acceptance Countdown Banner:** Once the receiver accepts, show the sender a 24-hour countdown to send a real reply. If that timer expires, auto-mark the request as ghosted.
7.  **AI Recovery Modal:** If a sender goes silent after acceptance, allow one last AI-assisted re-engagement: send a suggested reply, record a quick voice note, or trigger an optional AI scheduling call.

### Backend Schema Additions
Keep the existing `matches` row as the canonical conversation container, but add separate request-lifecycle tables so ghosting and intent quality can be measured without overloading the chat schema.

```sql
create type request_status_type as enum (
  'sent',
  'accepted',
  'declined',
  'expired',
  'ghosted',
  'closed'
);


### Exact Supabase Migration Blueprint
Use two migrations so the schema can land first and the helper RPCs plus RLS can evolve independently.

**Migration A:** `20260604000100_phase7_intent_escrow_schema.sql`

```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'request_status_type') then
    create type public.request_status_type as enum ('sent', 'accepted', 'declined', 'expired', 'ghosted', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'request_media_type') then
    create type public.request_media_type as enum ('none', 'voice', 'video');
  end if;
end
$$;

create table if not exists public.interest_requests (
  id uuid default gen_random_uuid() primary key,
  match_id uuid references public.matches(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  receiver_id uuid references public.profiles(id) on delete cascade not null,
  status public.request_status_type default 'sent' not null,
  personalized_reason text not null,
  ai_reason_summary text,
  media_type public.request_media_type default 'none' not null,
  media_url text,
  request_quality_score integer default 0 not null,
  sender_ghost_risk_score integer default 0 not null,
  accepted_at timestamp with time zone,
  first_reply_due_at timestamp with time zone,
  first_reply_at timestamp with time zone,
  ghosted_at timestamp with time zone,
  reminder_count integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint interest_requests_sender_receiver_check check (sender_id <> receiver_id)
);

create unique index if not exists interest_requests_match_sender_receiver_active_idx
  on public.interest_requests (match_id, sender_id, receiver_id)
  where status in ('sent', 'accepted');

create index if not exists interest_requests_receiver_status_created_idx
  on public.interest_requests (receiver_id, status, created_at desc);

create index if not exists interest_requests_sender_status_created_idx
  on public.interest_requests (sender_id, status, created_at desc);

create index if not exists interest_requests_due_at_idx
  on public.interest_requests (first_reply_due_at)
  where status = 'accepted' and first_reply_at is null;

create table if not exists public.interest_request_events (
  id uuid default gen_random_uuid() primary key,
  request_id uuid references public.interest_requests(id) on delete cascade not null,
  actor_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists interest_request_events_request_created_idx
  on public.interest_request_events (request_id, created_at desc);

create table if not exists public.profile_reliability_scores (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  response_reliability_score integer default 100 not null,
  ghost_risk_score integer default 0 not null,
  active_request_limit integer default 10 not null,
  accepted_requests integer default 0 not null,
  replied_within_sla_count integer default 0 not null,
  ghosted_request_count integer default 0 not null,
  median_first_reply_minutes integer,
  recalculated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_followup_jobs (
  id uuid default gen_random_uuid() primary key,
  request_id uuid references public.interest_requests(id) on delete cascade not null,
  provider text not null,
  channel text not null,
  status text default 'queued' not null,
  payload jsonb default '{}'::jsonb not null,
  executed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists ai_followup_jobs_request_status_idx
  on public.ai_followup_jobs (request_id, status, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_interest_requests_updated_at on public.interest_requests;
create trigger set_interest_requests_updated_at
before update on public.interest_requests
for each row execute function public.touch_updated_at();

alter table public.interest_requests enable row level security;
alter table public.interest_request_events enable row level security;
alter table public.profile_reliability_scores enable row level security;
alter table public.ai_followup_jobs enable row level security;
```

**Migration B:** `20260604000200_phase7_intent_escrow_policies.sql`

```sql
drop policy if exists "Participants view their interest requests" on public.interest_requests;
create policy "Participants view their interest requests" on public.interest_requests
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Participants view request events" on public.interest_request_events;
create policy "Participants view request events" on public.interest_request_events
  for select using (
    exists (
      select 1
      from public.interest_requests
      where interest_requests.id = interest_request_events.request_id
        and (interest_requests.sender_id = auth.uid() or interest_requests.receiver_id = auth.uid())
    )
  );

drop policy if exists "Users view their own reliability score" on public.profile_reliability_scores;
create policy "Users view their own reliability score" on public.profile_reliability_scores
  for select using (auth.uid() = profile_id);

drop policy if exists "Participants view their followup jobs" on public.ai_followup_jobs;
create policy "Participants view their followup jobs" on public.ai_followup_jobs
  for select using (
    exists (
      select 1
      from public.interest_requests
      where interest_requests.id = ai_followup_jobs.request_id
        and (interest_requests.sender_id = auth.uid() or interest_requests.receiver_id = auth.uid())
    )
  );

create or replace function public.get_active_interest_request_count(target_profile_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.interest_requests
  where sender_id = target_profile_id
    and status in ('sent', 'accepted');
$$;

grant execute on function public.get_active_interest_request_count(uuid) to authenticated;

create or replace function public.mark_interest_request_first_reply(target_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  update public.interest_requests
  set first_reply_at = coalesce(first_reply_at, timezone('utc'::text, now())),
      updated_at = timezone('utc'::text, now())
  where id = target_request_id
    and status = 'accepted'
    and first_reply_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.mark_interest_request_first_reply(uuid) to authenticated;
```

**Write-path rule:** Do not add direct `insert`, `update`, or `delete` policies for `interest_requests`, `interest_request_events`, `profile_reliability_scores`, or `ai_followup_jobs`. All writes should happen through service-role Edge Functions so request caps, ghost-risk checks, and SLA timestamps cannot be bypassed from the client.

### Exact Edge Function Contracts
Follow the current Supabase Edge Function pattern already used in this repo: require `Authorization`, derive the current user from the JWT, use the service role only for protected writes, and always return JSON.

1.  **Function:** `generate-request-reasons`
    * Purpose: produce the Connect Composer suggestions before a request is sent.
    * Request body:
      ```json
      {
        "candidateProfileId": "uuid",
        "mode": "sheet"
      }
      ```
    * Success response:
      ```json
      {
        "reasons": [
          { "id": "r1", "text": "Both families are based in Pune and prioritize career stability.", "score": 84, "tags": ["city", "career"] },
          { "id": "r2", "text": "You both mention long-term family values and balanced work-life goals.", "score": 79, "tags": ["values", "lifestyle"] },
          { "id": "r3", "text": "Your profiles show similar expectations around city flexibility and education.", "score": 75, "tags": ["city", "education"] }
        ],
        "requestQualityScore": 78,
        "requiresVoiceIntro": false,
        "ghostRiskScore": 18,
        "activeRequestCount": 2,
        "activeRequestLimit": 10
      }
      ```
    * Errors:
      * `401` unauthorized
      * `404` candidate not found
      * `409` sender is over the active outgoing request limit

2.  **Function:** `submit-interest-request`
    * Purpose: supersede `manage-match-request(send)` for Phase 7.
    * Request body:
      ```json
      {
        "candidateProfileId": "uuid",
        "selectedReasonId": "r1",
        "personalizedReason": "Both families are based in Pune and prioritize career stability.",
        "mediaType": "none",
        "mediaUrl": null,
        "voiceTranscript": null
      }
      ```
    * Success response:
      ```json
      {
        "requestId": "uuid",
        "matchId": "uuid",
        "status": "sent",
        "notice": "Request sent and chat opened.",
        "requestQualityScore": 78,
        "ghostRiskScore": 18,
        "activeRequestCountRemaining": 7,
        "message": {
          "id": "uuid",
          "match_id": "uuid",
          "sender_id": "uuid",
          "content": "Both families are based in Pune and prioritize career stability.",
          "is_flagged_by_system": false,
          "created_at": "timestamp"
        }
      }
      ```
    * Behavior:
      * validate active outgoing request limit
      * validate reason quality or approved voice intro
      * create or reuse the `matches` row
      * create the `interest_requests` row and `interest_request_events` rows
      * insert the initial chat message so the request is visible in Inbox and Chat

3.  **Function:** `accept-interest-request`
    * Purpose: supersede `manage-match-request(accept)` for Phase 7.
    * Request body:
      ```json
      {
        "requestId": "uuid"
      }
      ```
    * Success response:
      ```json
      {
        "requestId": "uuid",
        "matchId": "uuid",
        "status": "accepted",
        "acceptedAt": "timestamp",
        "firstReplyDueAt": "timestamp",
        "notice": "Request accepted and a default reply was sent.",
        "message": {
          "id": "uuid",
          "match_id": "uuid",
          "sender_id": "uuid",
          "content": "Hi, I accepted your request. Happy to continue the conversation here.",
          "is_flagged_by_system": false,
          "created_at": "timestamp"
        }
      }
      ```
    * Behavior:
      * validate that the current user is the receiver
      * update `interest_requests.status = 'accepted'`
      * set `accepted_at` and `first_reply_due_at`
      * update `matches.status = 'connected'`
      * insert the automatic default acceptance message

4.  **Function:** `review-request-voice-intro`
    * Purpose: approve or reject voice intros before they count as proof of intent.
    * Request body:
      ```json
      {
        "requestId": "uuid",
        "mediaUrl": "https://...",
        "durationSeconds": 21
      }
      ```
    * Success response:
      ```json
      {
        "approved": true,
        "transcript": "Hello, I am reaching out because our families are both based in Pune.",
        "summary": "Personalized and respectful voice intro.",
        "qualityAdjustment": 12,
        "rejectionReason": null
      }
      ```

5.  **Function:** `get-request-trust-summary`
    * Purpose: fetch the trust drawer payload for a profile or request card.
    * Request body:
      ```json
      {
        "targetProfileId": "uuid"
      }
      ```
    * Success response:
      ```json
      {
        "responseReliabilityScore": 86,
        "ghostRiskScore": 18,
        "activeRequestLimit": 10,
        "activeRequestCount": 2,
        "medianFirstReplyMinutes": 42,
        "managedBy": "parent",
        "badges": ["Replies quickly", "Low ghost risk"]
      }
      ```

6.  **Function:** `process-ghosting-followups`
    * Purpose: scheduled worker for nudges, ghosting transitions, and reliability recalculation.
    * Invocation: cron or scheduled trigger, not direct UI use.
    * Request body:
      ```json
      {
        "dryRun": false
      }
      ```
    * Success response:
      ```json
      {
        "scanned": 120,
        "nudged": 8,
        "ghosted": 3,
        "scoresRecalculated": 11,
        "callbacksQueued": 1
      }
      ```

7.  **Function:** `trigger-intent-callback` (Implemented)
    * Purpose: optional Retell or Vapi escalation for high-intent matches only.
    * Request body:
      ```json
      {
        "requestId": "uuid",
        "mode": "availability_check"
      }
      ```
    * Success response:
      ```json
      {
        "jobId": "uuid",
        "provider": "retell",
        "status": "queued"
      }
      ```
### Scoring Model
Use two separate scores: one for the quality of a single request, and one for the sender's long-term reliability.

1.  **Request Quality Score (0-100):**
    * 40 points: profile-specific personalization detected by Groq
    * 20 points: request is concrete and non-generic
    * 15 points: sender profile completeness and verification
    * 15 points: voice or video proof attached
    * 10 points: sender has a good recent follow-through history
2.  **Response Reliability Score (0-100):**
    * 35 points: accepted requests that receive a reply within 24 hours
    * 25 points: median first reply time after acceptance
    * 20 points: conversations that continue beyond one system message
    * 10 points: clean declines instead of silent expiration
    * 10 points: penalty adjustment for too many unresolved outgoing requests
3.  **Ghost Risk Score (0-100):**
    * derive from low reliability, too many active requests, repeated ghosted requests, and parent-managed bulk-sending patterns
    * 0-24: low risk, up to 10 active outgoing requests
    * 25-49: medium risk, cap at 5 active outgoing requests
    * 50-74: high risk, require voice intro after 3 open outgoing requests
    * 75-100: critical risk, block new requests until old ones are resolved or declined

### Enforcement Rules
1.  A sender cannot send more than their `active_request_limit` unresolved requests.
2.  Every outgoing request must include either an AI-personalized reason or an approved voice intro.
3.  After the receiver accepts, the sender must send a real follow-up reply within 24 hours.
4.  If the sender misses that SLA, the request is marked `ghosted`, the reliability score drops, and the receiver sees a transparent status such as "Sender went silent after acceptance."
5.  Repeated ghosters are progressively throttled into stricter flows: lower caps, then voice-note requirement, then optional selfie-video requirement.
6.  One AI reminder is allowed before marking the request ghosted. More than one reminder should be avoided because the product should not harass the receiver.

### AI Workflows
1.  **Workflow: Intent-Coached Request Send**
    * Trigger: user taps `Connect`
    * Groq input: both profiles, sender history, receiver preferences
    * Output: 3 short personalized reasons, request quality score, and whether voice proof is required
2.  **Workflow: Voice Intro Review**
    * Trigger: sender records a 15-30 second voice intro
    * Deepgram transcribes the clip, then Groq checks whether it is relevant, respectful, and not generic spam
    * Output: approved transcript, summary, and quality adjustment
3.  **Workflow: Post-Acceptance SLA Watcher**
    * Trigger: request accepted
    * Backend schedules `first_reply_due_at`
    * If the sender does not reply, queue one AI nudge and then mark ghosted on expiry
4.  **Workflow: Optional AI Callback**
    * Trigger: accepted request with no response after the AI nudge, only for opted-in or high-value matches
    * Retell AI or Vapi asks the sender if they still wish to continue and can offer to schedule a real call slot

### UX Copy Guidance
1.  Prefer language like "Show intent" and "Reply within 24 hours" instead of shame-based messaging.
2.  When a sender is throttled, explain the reason clearly: "You have 5 pending outgoing requests. Resolve or close one before sending more."
3.  When the receiver is ghosted, show a truthful recovery state: "This request expired because the sender did not follow up after you accepted."

### Phase 7 Implementation Order
1.  Ship personalized request reasons plus active-request caps first.
2.  Add the reliability score and post-acceptance 24-hour SLA next.
3.  Add the mandatory voice intro only for repeat ghost-risk users.
4.  Add selfie-video verification and optional AI callback only after the basic anti-ghosting loop proves useful.

### React Native Screen Flow & API Implementation Plan
Keep the current app structure intact: `App.tsx` still routes only between `AuthScreen`, `OnboardingScreen`, and `MainTabsScreen`, while Phase 7 should be implemented mostly as sheets, cards, drawers, and banners inside the existing `HomeScreen`, `MatchProfileScreen`, and `ChatScreen` surfaces.

1.  **HomeScreen.tsx**
  * Replace the direct `createPendingMatch(candidate.id)` send path with a two-step intent flow.
  * When the user swipes right or taps the high-intent action, open a `ConnectComposerSheet` instead of silently sending the request.
  * The sheet should call `generate-request-reasons`, display 3 AI suggestions, show the sender's current request limit state, and block submission if the sender is over their cap.
  * On confirm, call `submit-interest-request`, then remove the card from the feed and show a success notice.
  * If `requiresVoiceIntro` is true, route the user into the voice-intro recorder before allowing submit.

2.  **MatchProfileScreen.tsx**
  * Keep the current detail layout, but change `Connect now` so it launches the same `ConnectComposerSheet` used by `HomeScreen`.
  * Add a compact trust row near the bottom action area showing the receiver's manager type, response reliability badge, and whether the sender will need a voice intro.
  * Later, the richer action row can become `Super Connect`, `View Contact`, and `Connect Now`, where `Super Connect` preselects voice or video proof and `Connect Now` starts the standard personalized request flow.

3.  **ChatScreen.tsx**
  * Extend the existing request cards so Received requests show the personalized reason, trust summary, and optional voice-intro play button directly on the card.
  * When the receiver accepts, call `accept-interest-request`, set the `firstReplyDueAt`, and render a `PostAcceptanceCountdownBanner` for the sender.
  * On the sender side, the first real post-acceptance chat message should call `mark_interest_request_first_reply(uuid)` so the SLA closes cleanly.
  * If the request becomes `ghosted`, show a transparent status card such as `This request expired because the sender did not reply after acceptance.`
  * Keep the existing mutual contact-unlock flow intact; Intent Escrow runs before the later equal-payment unlock flow, not instead of it.

4.  **MainTabsScreen.tsx**
  * Recalculate `Inbox`, `Accepted`, and `Sent` counts from `interest_requests` state rather than relying only on `matches.status` plus unlock-state heuristics.
  * `Received` should map to requests where `receiver_id = auth.uid()` and `status = 'sent'`.
  * `Sent` should map to requests where `sender_id = auth.uid()` and `status = 'sent'`.
  * `Accepted` should map to requests where `status = 'accepted'` or the match has already progressed into active conversation state.
  * Keep `Home` and `Premium` as visible placeholders unless that broader footer decision changes later.

5.  **OnboardingScreen.tsx**
  * No major routing change is required, but add profile-completeness and manager-type confidence hints because they feed the request quality score.
  * Add simple consent copy for optional voice intros and optional selfie intent clips so later trust features do not feel abrupt.

6.  **New UI Components To Add**
  * `src/components/ConnectComposerSheet.tsx`: reason picker, free-text edit, request-limit messaging, submit CTA.
  * `src/components/RequestTrustDrawer.tsx`: trust summary, response rate, reply speed, ghost risk, manager type.
  * `src/components/VoiceIntroRecorder.tsx`: 15-30 second recording flow with transcript/review state.
  * `src/components/PostAcceptanceCountdownBanner.tsx`: sender-facing 24-hour reply deadline banner.
  * `src/components/SelfieIntentClipSheet.tsx`: deferred Phase 7 component, only for higher-trust verification later.

7.  **New Client Libraries**
  * `src/lib/intentEscrow.ts`: types such as `InterestRequest`, `RequestReasonSuggestion`, `ProfileReliabilitySummary`, and `InterestRequestStatus`.
  * `src/lib/intentEscrowApi.ts`: wrappers for `generate-request-reasons`, `submit-interest-request`, `accept-interest-request`, `get-request-trust-summary`, and `mark_interest_request_first_reply`.
  * `src/lib/voiceIntroApi.ts`: upload helper plus `review-request-voice-intro` integration.
  * `src/lib/requestRealtime.ts`: subscriptions for `interest_requests` updates so Inbox and Chat stay current.

8.  **API Wiring Plan**
  * Step 1: keep `manage-match-request` live as a fallback while `submit-interest-request` and `accept-interest-request` are introduced.
  * Step 2: update `HomeScreen` and `MatchProfileScreen` to use `generate-request-reasons` plus `submit-interest-request`.
  * Step 3: update `ChatScreen` accept flows to call `accept-interest-request` and consume `firstReplyDueAt`.
  * Step 4: once the new APIs are stable, retire the old send/accept branches inside `manage-match-request` or keep it only as a compatibility shim.

9.  **Realtime And Background Behavior**
  * Continue subscribing to `messages`, but also subscribe to `interest_requests` changes so the UI can react to sent, accepted, declined, and ghosted transitions without polling.
  * Scheduled jobs should own nudges, ghosting transitions, and reliability recalculation; the Expo client should only read the resulting state and timers.
  * Use optimistic UI only for the local submit tap, not for ghosting or reliability scores. Those should always come from the backend.

10. **Suggested Build Order Inside This Repo**
  * Phase 7A: add `intentEscrowApi.ts` and `ConnectComposerSheet`, then replace direct send actions in `HomeScreen` and `MatchProfileScreen`.
  * Phase 7B: enrich `ChatScreen` request cards with reasons, trust badges, and accept/decline decisions from `interest_requests`.
  * Phase 7C: add `firstReplyDueAt` countdowns plus the `mark_interest_request_first_reply` hook when the sender sends the first real reply.
  * Phase 7D: add `VoiceIntroRecorder` and `review-request-voice-intro` for users whose ghost-risk score requires proof.
  * Phase 7E: add the optional selfie-video and AI callback recovery layers only after the basic anti-ghosting loop is proving useful.

**Current repo:** Partial. The app now supports request creation, Inbox/Chat request visibility, auto-messages on acceptance, trust summary drawer, accepted-state reply countdown, ghosting followup worker, reliability score recalculation, voice-intro recorder + review path, callback orchestration via `trigger-intent-callback`, Chat CTA wiring to queue callback checks/recovery calls from accepted-waiting and ghosted states, and premium highlighted profile treatments in discovery/inbox. Remaining work includes deeper voice/video enforcement loops, selfie intent clips, and additional Phase 6 polish items.

---

# 6. How to Use This File with Copilot
1.  Start a new chat session with your AI Coding Assistant.
2.  Type: `@workspace Read claude.md. Let's start with Phase 1: Initialize the Expo app and set up Supabase Auth.`
3.  For database tasks, type: `Based on claude.md, generate the exact Supabase SQL migration for the schema.`
4.  For AI features, type: `Create the Next.js API route for Workflow 1 (AI Escrow Chat) using the prompt from claude.md.`



Mutual unlock rule: both matched users must agree to exchange contacts and both must pay the same one-time amount before contact details are unlocked.

what we can do is if first person try to pay to share contact before payemnt the other person should also confirm to pay then only both will be equal 

---

## Phase 8: AI Broker Re-Engagement & Verification Pipeline
This phase adds a human-like AI broker layer for accepted matches that stall before meaningful follow-up. It is designed to reduce silent drop-offs without forcing users into paid lockouts.

### Product Rule
1. Once an interest request is accepted, the sender gets a 24-hour follow-up SLA using `first_reply_due_at` from `public.interest_requests`.
2. If the sender has not posted a real follow-up message and the SLA is approaching expiry, the AI Broker flow is activated before hard ghosting.
3. Broker activation window:
   * T-6h: first AI broker nudge using Vapi or Retell voice call (or SMS/WhatsApp if voice is unavailable).
   * T-1h: final AI broker nudge using the best available channel.
   * At expiry (`first_reply_due_at` passed): mark request as `ghosted` only after broker attempts are exhausted or consent is declined.
4. Broker behavior:
   * Ask both users if they still want to continue.
   * Confirm preferred next step (continue in-app chat, exchange contact via mutual unlock, schedule call).
   * Record structured outcomes in database for transparency and reliability scoring.
5. Consent rule:
   * Outbound broker calls/messages must respect explicit user consent.
   * If consent is denied, no further broker attempts are queued for that request.

### Recommended AI Stack
1. **Vapi or Retell AI (Voice Broker):**
   * Runs natural voice broker conversations.
   * Collects intent outcomes (continue, pause, decline, request callback).
2. **Twilio WhatsApp Business API (Text Fallback):**
   * Sends consent prompts and follow-up reminders when voice is unavailable or declined.
3. **Supabase Edge Functions + Cron:**
   * Edge Functions handle consent, call triggering, webhook processing, and write-path enforcement.
   * Cron schedules pre-expiry broker attempts tied to `first_reply_due_at`.

### Database Architecture Schema
Use this migration to add broker call state tracking.

```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'broker_call_status_type') then
    create type public.broker_call_status_type as enum (
      'queued',
      'consent_required',
      'consent_granted',
      'dialing',
      'in_progress',
      'completed',
      'declined',
      'no_answer',
      'failed',
      'cancelled'
    );
  end if;
end
$$;

create table if not exists public.ai_broker_calls (
  id uuid default gen_random_uuid() primary key,

  request_id uuid references public.interest_requests(id) on delete cascade not null,
  match_id uuid references public.matches(id) on delete cascade not null,

  sender_profile_id uuid references public.profiles(id) on delete cascade not null,
  receiver_profile_id uuid references public.profiles(id) on delete cascade not null,
  target_profile_id uuid references public.profiles(id) on delete cascade not null,
  triggered_by_profile_id uuid references public.profiles(id) on delete set null,

  provider text not null check (provider in ('vapi', 'retell', 'twilio')),
  channel text not null check (channel in ('voice', 'sms_whatsapp')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),

  status public.broker_call_status_type default 'queued' not null,
  consent_required boolean default true not null,
  consent_granted boolean,
  consent_recorded_at timestamp with time zone,

  attempt_number integer default 1 not null check (attempt_number >= 1),
  scheduled_for timestamp with time zone,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,

  provider_call_id text,
  provider_message_id text,
  outcome text,
  transcript text,
  summary jsonb default '{}'::jsonb not null,
  metadata jsonb default '{}'::jsonb not null,
  last_error text,

  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  constraint ai_broker_calls_sender_receiver_check check (sender_profile_id <> receiver_profile_id),
  constraint ai_broker_calls_target_participant_check check (target_profile_id = sender_profile_id or target_profile_id = receiver_profile_id)
);

create unique index if not exists ai_broker_calls_active_attempt_idx
  on public.ai_broker_calls (request_id, target_profile_id, channel)
  where status in ('queued', 'consent_required', 'consent_granted', 'dialing', 'in_progress');

create index if not exists ai_broker_calls_request_created_idx
  on public.ai_broker_calls (request_id, created_at desc);

create index if not exists ai_broker_calls_match_created_idx
  on public.ai_broker_calls (match_id, created_at desc);

create index if not exists ai_broker_calls_target_status_scheduled_idx
  on public.ai_broker_calls (target_profile_id, status, scheduled_for);

create index if not exists ai_broker_calls_status_scheduled_idx
  on public.ai_broker_calls (status, scheduled_for);

create unique index if not exists ai_broker_calls_provider_call_id_idx
  on public.ai_broker_calls (provider_call_id)
  where provider_call_id is not null;

create unique index if not exists ai_broker_calls_provider_message_id_idx
  on public.ai_broker_calls (provider_message_id)
  where provider_message_id is not null;

drop trigger if exists set_ai_broker_calls_updated_at on public.ai_broker_calls;
create trigger set_ai_broker_calls_updated_at
before update on public.ai_broker_calls
for each row execute function public.touch_updated_at();

alter table public.ai_broker_calls enable row level security;

drop policy if exists "Participants view broker calls" on public.ai_broker_calls;
create policy "Participants view broker calls" on public.ai_broker_calls
  for select using (auth.uid() = sender_profile_id or auth.uid() = receiver_profile_id);
```

### Edge Function Contracts
Follow the same project pattern: require Authorization, resolve current user from JWT, do protected writes with service role, and always return JSON.

1. **Function: `send-broker-consent`**
   * Purpose: capture participant consent preference before AI broker outreach.
   * Request body:
   ```json
   {
     "requestId": "uuid",
     "consent": true,
     "preferredChannel": "voice",
     "preferredProvider": "retell",
     "locale": "en-IN"
   }
   ```
   * Success response:
   ```json
   {
     "requestId": "uuid",
     "consentRecorded": true,
     "consentStatus": "granted",
     "preferredChannel": "voice",
     "nextAction": "broker_call_queued",
     "brokerCallId": "uuid"
   }
   ```
   * Errors:
     * `401` unauthorized
     * `403` user is not a participant in the request
     * `404` request not found
     * `409` request no longer eligible (already ghosted/closed)

2. **Function:** `trigger-outbound-broker-call`
   * Purpose: queue/schedule broker call or WhatsApp fallback during countdown windows before hard ghosting.
   * Invocation: cron worker or internal backend trigger (not direct user flow).
   * Request body:
   ```json
   {
     "requestId": "uuid",
     "targetProfileId": "uuid",
     "mode": "countdown_nudge",
     "channel": "voice",
     "provider": "vapi",
     "dryRun": false
   }
   ```
   * Success response:
   ```json
   {
     "brokerCallId": "uuid",
     "requestId": "uuid",
     "status": "queued",
     "provider": "vapi",
     "channel": "voice",
     "scheduledFor": "timestamp",
     "notice": "Outbound broker attempt queued before first_reply_due_at."
   }
   ```
   * Errors:
     * `400` invalid mode/channel/provider payload
     * `401` unauthorized invocation
     * `404` request or target profile not found
     * `409` consent denied, duplicate active attempt, or request already resolved

3. **Function: `handle-broker-call-webhook`**
   * Purpose: process provider callbacks (Vapi/Retell/Twilio), update call/message status, persist transcript/outcome, and trigger next-step actions.
   * Secure Webhook Authentication Scheme: Authenticates the third-party client via query string checks against a shared project webhook secret (`?token=your_secret_key`), preventing arbitrary malicious payload posts.
   * Target Profile Matching: Automatically assigns target profiles using the outbound metadata fields.
   * Chat Stream Closures: In case of match declines or positive closures, inserts a plain-language notification bubble inside the chat room from the target profile, allowing immediate clarity to the match originator.
   * Request body:
   ```json
   {
     "provider": "retell",
     "eventType": "call.completed",
     "providerCallId": "ext_call_123",
     "providerMessageId": null,
     "status": "completed",
     "durationSeconds": 142,
     "targetProfileId": "uuid",
     "requestId": "uuid",
     "outcome": "user_wants_to_continue",
     "transcript": "Yes, I want to continue this match. Please notify the other person.",
     "summary": {
       "intent": "continue",
       "preferredContactMode": "whatsapp_after_unlock"
     },
     "rawPayload": {
       "any": "provider-specific payload"
     }
   }
   ```
   * Success response:
   ```json
   {
     "processed": true,
     "brokerCallId": "uuid",
     "status": "completed",
     "nextAction": "notify_counterparty",
     "requestStatus": "accepted"
   }
   ```
   * Errors:
     * `400` malformed webhook body
     * `401` invalid provider signature/auth
     * `404` no matching broker call/request
     * `409` stale or duplicate webhook event

### Implementation Notes
1. Broker outreach augments Intent Escrow and does not bypass mutual unlock payment rules.
2. Contact exchange remains blocked until both users complete the existing equal-payment unlock flow.
3. Call Expiration & Duplicate Cleanup: To prevent attempts from permanently locking out requests when webhooks are lost or delayed, `trigger-outbound-broker-call` runs an automatic timeout sweep. Any call row left in `queued`, `dialing`, or `in_progress` for longer than 15 minutes (`STALE_BROKER_CALL_MS = 1500000`) is marked `failed` (`auto_expired_no_terminal_webhook`), immediately unlocking the queue gate.
4. Broker outcomes should be mirrored into `interest_request_events` for auditability.
5. Keep one active broker attempt per request/target/channel to prevent spam.


