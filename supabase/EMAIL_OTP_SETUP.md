# Email OTP Setup (Real Verification Emails)

This guide makes OpenMatch send a **real 6-digit OTP code** to a user's email
during sign-up, and how to verify it in the app.

The app calls `supabase.auth.signInWithOtp({ email })` to send the code and
`supabase.auth.verifyOtp({ email, token, type: 'email' })` to verify it. For a
code to actually arrive, Supabase needs (1) a working email sender (SMTP) and
(2) templates that expose the `{{ .Token }}` code.

---

## 1. Files in this folder

| File | Purpose |
| --- | --- |
| `config.toml` | Auth + email + SMTP config (uses `env(...)` for secrets). |
| `templates/confirmation.html` | Sign-up confirmation — shows the 6-digit code. |
| `templates/magic_link.html` | Email OTP sign-in — shows the 6-digit code. |
| `templates/recovery.html` | Password reset code. |
| `templates/email_change.html` | Email-change confirmation code. |

All templates render `{{ .Token }}` (the 6-digit code) instead of a magic link.

---

## 2. Configure a real SMTP provider (recommended)

The built-in Supabase mailer is rate-limited (~2–4/hour) and only for testing.
For real users, connect **any** SMTP server. Twilio is **not** required — SMTP
is a standard email protocol supported by every mail provider.

### Dedicated email providers (best deliverability)

| Provider | Host | Port | User | Pass |
| --- | --- | --- | --- | --- |
| **Resend** | `smtp.resend.com` | `465` | `resend` | your API key (`re_...`) |
| **SendGrid** | `smtp.sendgrid.net` | `587` | `apikey` | your API key |
| **AWS SES** | `email-smtp.<region>.amazonaws.com` | `587` | SMTP user | SMTP password |
| **Postmark** | `smtp.postmarkapp.com` | `587` | server token | server token |
| **Mailgun** | `smtp.mailgun.org` | `587` | postmaster@your-domain | SMTP password |

### Plain mailbox SMTP (quick / free — fine for low volume & testing)

| Provider | Host | Port | User | Pass |
| --- | --- | --- | --- | --- |
| **Gmail** | `smtp.gmail.com` | `465` | your Gmail address | a Google **App Password** (not your login password) |
| **Outlook / Microsoft 365** | `smtp.office365.com` | `587` | your address | your mailbox password / app password |
| **Zoho Mail** | `smtp.zoho.com` | `465` | your address | app password |

> **Gmail note:** you must enable 2-Step Verification, then create an
> **App Password** at <https://myaccount.google.com/apppasswords> and use that
> 16-character value as `SMTP_PASS`. Gmail limits free accounts to ~500
> emails/day, so use a dedicated provider (Resend/SendGrid) for production.

Export the credentials before pushing config (Gmail example):

```bash
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="465"
export SMTP_USER="youraddress@gmail.com"
export SMTP_PASS="abcd efgh ijkl mnop"      # Google App Password
export SMTP_ADMIN_EMAIL="youraddress@gmail.com"   # the "from" address
export SMTP_SENDER_NAME="OpenMatch"
```

Resend example:

```bash
export SMTP_HOST="smtp.resend.com"
export SMTP_PORT="465"
export SMTP_USER="resend"
export SMTP_PASS="re_xxxxxxxxxxxxxxxxxxxx"
export SMTP_ADMIN_EMAIL="no-reply@yourdomain.com"   # must be a verified sender
export SMTP_SENDER_NAME="OpenMatch"
```

> With dedicated providers, verify your sending domain first or emails may
> bounce / land in spam. With Gmail the "from" must be your Gmail address.

---

## 3. Apply the config

### Option A — Supabase CLI (recommended)
```bash
# from the repo root
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase config push
```

### Option B — Dashboard (manual)
1. **Authentication → Providers → Email**: enable provider + "Confirm email".
2. **Authentication → Emails → SMTP Settings**: turn on Custom SMTP and paste
   the credentials above.
3. **Authentication → Email Templates**: for **Confirm signup** and **Magic
   Link**, paste the contents of the matching file in `templates/`. Make sure
   the body contains `{{ .Token }}` (not `{{ .ConfirmationURL }}`).

---

## 4. Point the app at real OTP

In `openmatch/.env` (client env):

```bash
# false (or unset) = send REAL OTP emails
EXPO_PUBLIC_ENABLE_MOCK_EMAIL_OTP=false
```

Restart the Expo dev server so the env change is picked up:

```bash
cd openmatch
npm run dev
```

Now sign up with a real email → a 6-digit code arrives → enter it on the
"Verify Email OTP Code" screen → onboarding begins.

---

## 5. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error sending magic link email` | SMTP not configured or credentials wrong. Re-check step 2. |
| Email has a link, not a code | Template still uses `{{ .ConfirmationURL }}`. Use `{{ .Token }}`. |
| `Email rate limit exceeded` | You're on the built-in mailer. Configure custom SMTP. |
| `User already registered` | The email exists from a prior attempt — use the **Sign In** tab, or delete the user in **Authentication → Users**. |
| Code says expired | Increase `otp_expiry` in `config.toml` (seconds). |
