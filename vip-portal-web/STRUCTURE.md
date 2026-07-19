# VIP Concierge Portal Next.js App Router Structure

This directory contains the role-isolated web layout and dashboard views for the hidden, premium VIP experience.

## App Route Structure

```text
vip-portal-web/
├── app/
│   ├── layout.tsx                # Root layout (handles global HTML/body, font definitions)
│   ├── (standard)/               # Route Group for standard tiers (BASIC, PRO, etc.)
│   │   ├── layout.tsx            # Verification check: redirects VIP users to /dashboard/vip
│   │   └── dashboard/
│   │       └── page.tsx          # Standard match/onboarding portal UI view
│   └── (vip)/                    # Route Group for VIP Concierge tier
│       ├── layout.tsx            # Shell setting dark-mode theme styles & VIP check
│       └── dashboard/
│           └── vip/
│               └── page.tsx      # Integrated VIP Dashboard UI with AI Waveform & Ledger
├── middleware.ts                 # Next.js Middleware guarding paths based on Supabase profiles.user_tier
├── package.json                  # Next.js configuration & dependencies
└── tsconfig.json                 # TypeScript compiler configuration
```
