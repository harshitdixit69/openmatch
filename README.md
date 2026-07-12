# OpenMatch

A matrimonial matchmaking platform built with React Native, Supabase, and AI-powered semantic matching.

## Overview

OpenMatch is a full-stack mobile app that helps users find compatible matches through:
- **AI Semantic Matching**: Vector embeddings + cosine distance for compatibility scoring
- **Intelligent Escrow**: Mutual contact unlock with payment intent flow (Phase 7)
- **Trust Signals**: Broker-mediated calls, ghost-risk scoring, response reliability tracking (Phase 8)
- **Rich Profiles**: Structured fields, partner preferences, shortlists, profile views

## Architecture

### Frontend (`openmatch/`)
- **React Native** with TypeScript
- **5 Main Tabs**: Home (feed), Matches, Inbox (requests), Chat, Premium
- **8 Modal Screens**: Partner Preferences, Profile Edit, Settings, Search, Shortlist, Dashboard, Notifications, Who Viewed Me
- **State Management**: React hooks + Supabase Realtime
- **UI Patterns**: Card swiping (Animated), bottom sheets, modals

### Backend (`supabase/`)
- **PostgreSQL + pgvector** for vector similarity search
- **45+ Migrations**: Core schema + features + security fixes
- **18 Edge Functions**: AI generation, broker orchestration, payment handling
- **RLS Policies**: Row-level security on all user-scoped tables
- **Realtime Subscriptions**: Chat messages, interest requests, notifications

## Key Features Implemented

### F1–F9: Core Functionality
- **F1**: Partner Preferences (age, height, education, diet, religion, location flexibility)
- **F2**: Profile Edit Screen (5-section form with photo management)
- **F3**: Settings Screen (account, notifications, privacy, danger zone)
- **F4**: Search/Discovery (text + filter chips)
- **F5**: Shortlist/Bookmarks (save profiles for later)
- **F6**: My Matches (filter by connected/unlocked/pending)
- **F7**: Who Viewed My Profile (recent visitors)
- **F8**: Notifications (Realtime in-app + push support)
- **F9**: Dashboard (activity stats, reliability score, ghost risk)

### Phase 7: Intent Escrow
- **Interest Requests**: AI-generated request reasons + optional voice intro
- **Mutual Unlock**: Both parties accept + pay to share contact details
- **Payment Intents**: Stripe integration for escrow flow
- **Countdown Tracking**: `first_reply_due_at` deadline enforcement

### Phase 8: AI Broker Calls
- **Broker Orchestration**: Retell/VAPI/Twilio integration
- **Consent Flow**: Sender → receiver consent, channel preference (voice/SMS+WhatsApp)
- **Followup Jobs**: Automated ghosting detection + reminder messages
- **Call Summaries**: AI-generated meeting notes

## Recent Audit & Fixes (2026-07-13)

### Security
- **get_activity_stats**: Removed `p_user_id` param → uses `auth.uid()` internally (prevents reading other users' stats)
- **upsert_profile_view**: Removed `p_viewer_id` param → uses `auth.uid()` internally (prevents spoofed viewer IDs)
- **markNotificationRead**: Added `.eq('user_id', user.id)` guard (prevents cross-user notification tampering)
- **notifications table**: Added service-role insert policies to `respond-interest-request`, `send-escrow-message`, `update-match-unlock` Edge Functions

### Performance
- **HNSW Index**: Replaced sequential scan on `profiles.embedding` with `USING hnsw (embedding vector_cosine_ops)`
- **Message Pagination**: Added `.limit(500)` to `fetchChatMatches` messages sub-query
- **Feed Auto-Fetch**: Triggers silent reload when user is 5 cards from end of candidate list (limit raised 20→50)
- **Tab Switch Debounce**: 5-second debounce on tab changes; poll interval increased 20s→45s (Realtime subscriptions handle urgency)

### Code Quality
- Removed 4 debug `console.log` statements from `matchmakingApi.ts`
- Removed dead `filterCandidatesByGenderPreferences` (DB already filters)
- Removed dead `shouldUseLegacyMatchFunction` fallback branch
- Removed hardcoded FK hint in `fetchShortlist`
- Added BackHandler for all modal screens (Android back button support)
- Dashboard stats refresh on app focus (AppState listener)
- `recordProfileView` wired into `MatchProfileScreen`
- In-flight request deduplication for `fetchChatMatches`

## Project Structure

```
openmatch/
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── BookmarkButton.tsx
│   │   ├── ConnectComposerSheet.tsx
│   │   ├── RequestTrustDrawer.tsx
│   │   └── prefs/          # Partner preference pickers
│   ├── lib/                # API & utilities
│   │   ├── chatApi.ts      # Messages, matches, unlock
│   │   ├── matchmakingApi.ts # Semantic feed + filtering
│   │   ├── notificationsApi.ts # Realtime notifications
│   │   ├── profileViewsApi.ts  # Who viewed me
│   │   ├── shortlistApi.ts     # Bookmarks
│   │   ├── activityStatsApi.ts # Dashboard
│   │   ├── intentEscrowApi.ts  # Interest requests
│   │   └── ...
│   └── screens/            # Full-page screens
│       ├── HomeScreen.tsx  # Feed + swipe cards
│       ├── ChatScreen.tsx  # Escrow messages + unlock flow
│       ├── DashboardScreen.tsx # Activity stats
│       └── ...
├── app.json                # Expo config
├── package.json
└── tsconfig.json

supabase/
├── migrations/             # 45+ SQL migrations
│   ├── 20260524000100_initial.sql
│   ├── 20260604000100_phase7_intent_escrow_schema.sql
│   ├── 20260606000300_phase8_ai_broker_calls_schema.sql
│   └── 20260714000700_fix_activity_stats_security.sql
├── functions/              # 18 Edge Functions
│   ├── submit-interest-request/
│   ├── generate-request-reasons/
│   ├── respond-interest-request/    # Added notification insert
│   ├── send-escrow-message/         # Added notification insert
│   ├── update-match-unlock/         # Added notification insert
│   ├── trigger-intent-callback/
│   ├── trigger-outbound-broker-call/
│   └── ...
└── scripts/

docs/
├── FEATURE_BACKLOG.md      # Remaining work
└── FEATURE_COMPARISON.md   # Competitor analysis
```

## Getting Started

### Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- Supabase CLI: `npm install -g supabase`

### Setup

1. **Clone & Install**
   ```bash
   git clone https://github.com/harshitdixit69/openmatch.git
   cd openmatch/openmatch
   npm install
   ```

2. **Environment Variables**
   ```bash
   cp .env.example .env.local
   # Edit with your Supabase keys
   ```

3. **Run Migrations**
   ```bash
   cd ../supabase
   supabase migration push --linked
   ```

4. **Start Dev Server**
   ```bash
   cd ../openmatch
   npm start
   ```

## Tech Stack

| Layer | Tech |
|-------|------|
| Mobile | React Native, Expo |
| Frontend State | React Hooks, AsyncStorage |
| Backend Database | PostgreSQL, Supabase |
| Vector Search | pgvector, HNSW index |
| AI | OpenAI embeddings, Azure chat |
| Auth | Supabase Auth (email/password) |
| Payments | Stripe (payment intents) |
| Voice/Calls | Retell AI, VAPI, Twilio |
| Real-time | Supabase Realtime (WebSocket) |

## Key Metrics

- **Vector Search Latency**: ~50ms (HNSW index, ~100 profiles)
- **Message Load**: 500-message cap per match (prevents O(N×M) blowup)
- **Notification Delivery**: <100ms (Realtime subscription)
- **DB Connections**: 5 concurrent queries in `fetchChatMatches` (deduplicated in-flight)

## Known Limitations

1. **L3 VoiceIntroRecorder**: Component exists but client-side record/upload path is not wired (Phase 7D)
2. **Legacy Match Function**: Modern `match_profiles(p_viewer_id)` only; fallback to `query_embedding` removed
3. **Feed Limit**: Hard-coded 50 profiles per load (auto-fetches but no infinite scroll pagination)
4. **Broker Calls**: Consent flow manual (no in-app consent dialog yet)

## Next Steps

- **Phase 10**: Typing indicator + read receipts
- **Phase 11**: Advanced search (distance-based, activity score)
- **Phase 12**: Premium features (ad-free, priority matching)
- **Phase 13**: Analytics dashboard (admin panel)

## Contributing

See `FEATURE_BACKLOG.md` for the roadmap. All PRs welcome — please include tests.

## License

Proprietary — OpenMatch Inc.

---

**Last Updated**: 2026-07-13  
**Build Commit**: `d9fa201`
