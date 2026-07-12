# Feature Comparison: matrimonial-llm-app vs openmatch

> Generated: July 12, 2026

---

## 1. Shared Features (Present in Both)

| Category | Feature | matrimonial-llm-app | openmatch |
|----------|---------|--------------------:|----------:|
| **Auth** | Email/password signup & login | ✅ FastAPI + JWT | ✅ Supabase Auth |
| **Auth** | Session management | ✅ JWT refresh tokens | ✅ Supabase session |
| **Onboarding** | AI-guided profile creation | ✅ AI chat flow (5 endpoints) | ✅ `OnboardingScreen` + `onboarding-copilot` edge fn |
| **Onboarding** | AI bio generation | ✅ Profile builder service | ✅ Copilot generates bio + preferences |
| **Profile** | Basic profile fields (name, gender, DOB, location, bio) | ✅ Editable sections | ✅ `profiles` table + `profileApi.ts` |
| **Profile** | Profile owner type (Self/Parent/Sibling) | ✅ "Posted By" field | ✅ `profile_owner` enum |
| **Profile** | Photo upload & display | ✅ Photo gallery (20 max) | ✅ `profilePhotoApi.ts` + `photo_urls` |
| **Matching** | AI compatibility scoring | ✅ Score-pair matching | ✅ pgvector cosine similarity + `generate-compatibility-summary` |
| **Matching** | Match feed with explanations | ✅ My Matches / New / Today | ✅ `HomeScreen` card-swipe feed with AI snapshots |
| **Matching** | Interest send / receive / accept / decline | ✅ Discovery connect/accept/decline | ✅ Intent Escrow: `submit-interest-request` → `respond-interest-request` |
| **Matching** | Match filters (gender, age, location) | ✅ FilterSidebar (10+ filters) | ✅ Gender pref filter, search chips (New/Daily/Photos/Nearby) |
| **Chat** | Real-time messaging | ✅ Chat rooms + WebSocket | ✅ Supabase Realtime subscriptions |
| **Chat** | AI conversation assistance | ✅ Ice-breakers, coaching tips, chemistry score | ✅ `generate-chat-prompts` + `generate-chat-copilot` + chemistry/fit-friction |
| **Chat** | Message moderation (PII blocking) | ✅ AI-based moderation | ✅ `send-escrow-message` (AI PII filter) |
| **Chat** | Read receipts / seen status | ✅ Mark as read | ✅ `read_at` tracking |
| **Chat** | Unread count badges | ✅ Unread count API | ✅ Badge counts on tabs |
| **Safety** | Report user | ✅ Report endpoint | ✅ Report action in profile |
| **Safety** | Block user | ✅ Block + blocked list | ✅ Block action |
| **Safety** | Trust/verification badges | ✅ Blue tick verified badge | ✅ Trust score system + reliability badges |
| **Premium** | Premium promo surfaces | ✅ PaywallModal + plan page | ✅ `PremiumPromoModal` + non-coercive promo cards |
| **Premium** | Feature gating | ✅ Premium check per feature | ✅ Mutual unlock gating (micro-transaction) |
| **Monetization** | Paid access to contacts | ✅ Subscription plans (Gold/Diamond/Platinum) | ✅ Stripe micro-transaction mutual unlock ($1/₹99) |
| **Navigation** | Tab-based navigation | ✅ Top nav + mobile bottom nav | ✅ Bottom footer: Home, Matches, Inbox, Chat, Premium |
| **Notifications** | In-app notifications | ✅ Notification feed + mark read | ✅ Notification badge in utility strip |

---

## 2. Features MISSING in openmatch (Present in matrimonial-llm-app)

### 🔴 Critical / High Impact

| # | Feature | Description | matrimonial-llm-app Status |
|---|---------|-------------|---------------------------|
| 1 | **Profile Edit Screen** | Dedicated editable profile page with sections (About, Education, Family, Lifestyle, Religious, Astro) | ✅ `/profile` page with section edit |
| 2 | **Partner Preferences Page** | Dedicated page to set/edit partner criteria (age range, religion, height, education, income, marital status) | ✅ `/partner-preferences` with 5 sections |
| 3 | **Search Page** | Full-text search with advanced filters, sort, pagination, profile grid | ✅ `/search` with 10+ filters, sort, pagination |
| 4 | **Shortlist / Bookmark Profiles** | Save profiles for later review | ✅ Shortlist API + `/matches/shortlist` page |
| 5 | **My Matches Page (Connections)** | View all accepted/mutual matches in one place | ✅ `/matches/my-matches` with carousel + filters |
| 6 | **Today's Matches / Daily Picks** | Curated daily match recommendations with countdown | ✅ `/matches/today` with countdown timer |
| 7 | **Settings Page** | Account settings, privacy options, notification prefs, change password, delete account | ✅ `/settings` with 5 sub-sections |
| 8 | **Who Viewed My Profile** | See who visited your profile (premium-gated) | ✅ `/matches/viewed-me` + viewers API |
| 9 | **Full Notifications Page** | Dedicated notifications list with mark-all-read | ✅ 6 notification endpoints |
| 10 | **Phone OTP Verification** | Phone number verification via OTP — critical trust signal for Indian market | ✅ Mobile verification endpoint |
| 11 | **Dashboard / Activity Summary** | Stats overview: interests sent/received, profile views, chats active, AI insights | ✅ `/dashboard` with 6 stat APIs |

### 🟡 Medium Impact

| # | Feature | Description | matrimonial-llm-app Status |
|---|---------|-------------|---------------------------|
| 12 | **Subscription Plans Page** | Plan comparison (Free/Gold/Diamond/Platinum) with pricing | ✅ `/premium` + plans API |
| 13 | **Photo Management** | Photo labels, set primary, count limits, format/size validation | ✅ `/photos` with full management |
| 14 | **Horoscope / Kundali Details** | Astro compatibility — critical for Indian matrimony | Planned (🔴 in TODO) |
| 15 | **Preview Your Profile** | See how your profile looks to others | Planned |
| 16 | **Profile Stats / Analytics** | Views, impressions, response rates on your profile | Planned |
| 17 | **Interests Page (Sent/Received/Accepted)** | Categorized interest tracking page | ✅ `/matches/interests` with tabs |
| 18 | **Typing Indicator** | Show when the other person is typing | ✅ Typing API endpoint |
| 19 | **Online Status / Presence** | Show if a user is currently online | ✅ Presence endpoint |
| 20 | **Admin Panel** | User management, reports, bans, system health | ✅ `/admin` with 8 endpoints |
| 21 | **Advanced Search Filters** | Income range, height, diet, smoking, drinking | ✅ FilterSidebar |
| 22 | **Height Range Picker** | Partner preference for height (core Shaadi filter) | ✅ In preferences |
| 23 | **Profile ID System** | Generate & display unique member IDs | ✅ Implemented |

### 🟢 Low Impact / Nice-to-Have

| # | Feature | Description |
|---|---------|-------------|
| 24 | Like/Unlike Profiles | Separate from interest send |
| 25 | Archive Chat Rooms | Hide old conversations |
| 26 | Saved Searches | Save filter combos |
| 27 | Photo Approval Status | Moderation indicator |
| 28 | "Near Me" Location Matching | GPS-based proximity |
| 29 | Refer A Friend | Growth/viral feature |
| 30 | ID Document Verification | Government ID upload |
| 31 | Selfie Verification | Photo match verification |

---

## 3. Features UNIQUE to openmatch (Not in matrimonial-llm-app)

| # | Feature | Description |
|---|---------|-------------|
| 1 | **AI Escrow Chat** | PII-blocking moderated chat until mutual unlock payment |
| 2 | **Mutual Unlock Micro-Transaction** | Both users pay $1/₹99 to exchange contacts (fair-pay model) |
| 3 | **Stripe + Apple Pay Integration** | Native payment sheets inside chat thread |
| 4 | **Intent Escrow System** | Personalized reasons, voice intros, quality scoring, ghost-risk scoring before sending interest |
| 5 | **AI Broker Voice Calls (Retell)** | Automated outbound voice calls to re-engage stalled matches |
| 6 | **Post-Call Webhook Pipeline** | Full Retell/Vapi/Twilio webhook → DB → chat-message automation |
| 7 | **Anti-Ghosting SLA** | 24-hour reply countdown, auto-ghosted status, recovery tools |
| 8 | **Profile Reliability Scoring** | Response rate, ghost risk, median reply time tracked per user |
| 9 | **Voice Intro Recording** | 15-30 second voice notes attached to interest requests |
| 10 | **Fit & Friction Breakdown** | AI-generated "why you match" + "potential friction" analysis |
| 11 | **AI Chat Copilot** | Context-aware reply suggestions inside the chat |
| 12 | **Premium Promo A/B Testing** | Deterministic bucketing, arm-tagged analytics, cooldown/retirement |
| 13 | **React Native Mobile App** | Native iOS/Android via Expo (vs. web-only Next.js) |
| 14 | **pgvector Semantic Matching** | Embedding-based profile similarity using cosine distance |

---

## 4. Summary

| Metric | matrimonial-llm-app | openmatch |
|--------|--------------------:|----------:|
| **Stack** | Next.js 14 + FastAPI + PostgreSQL | React Native (Expo) + Supabase + Edge Functions |
| **Platform** | Web only | Mobile (iOS/Android) + Web |
| **Screens/Pages** | 20+ pages | 6 screens |
| **API Endpoints** | 121 routes | ~22 edge functions |
| **DB Tables** | 18+ | 10+ (profiles, matches, messages, interest_requests, ai_broker_calls, etc.) |
| **Breadth** | Wide (Dashboard, Search, Settings, Admin, Photos, Preferences) | Deep (AI Escrow, Intent Escrow, Broker Calls, Anti-Ghosting) |
| **Monetization** | Subscription tiers (Gold/Diamond/Platinum) | Micro-transaction mutual unlock |
| **AI Depth** | Onboarding + matching + chat suggestions | Onboarding + matching + escrow + broker calls + voice intros + copilot + fit/friction |

**Key Takeaway:** `matrimonial-llm-app` has **broader feature coverage** (profile edit, search, settings, admin, shortlist, notifications). `openmatch` has **deeper AI/trust innovation** (escrow chat, broker calls, intent quality, anti-ghosting). The top priorities to port from matrimonial-llm-app to openmatch are: **Profile Edit, Partner Preferences, Search, Settings, and Shortlist**.
