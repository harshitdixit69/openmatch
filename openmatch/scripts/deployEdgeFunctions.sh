#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy the Cisco-AI-enabled edge functions and set their server-side secrets.
#
# Prerequisites:
#   1. A Supabase personal access token from
#      https://supabase.com/dashboard/account/tokens
#   2. Export it before running:  export SUPABASE_ACCESS_TOKEN=sbp_xxx
#      (or run `supabase login` once).
#
# Usage:
#   export SUPABASE_ACCESS_TOKEN=sbp_xxx
#   bash scripts/deployEdgeFunctions.sh
# ---------------------------------------------------------------------------
set -euo pipefail

# Path to the Supabase CLI binary (the prebuilt Go binary installed locally).
SB="${SUPABASE_CLI:-$HOME/.supabase-cli/sb}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-oxdhkjernhpkscrideby}"

# The Supabase project root is the directory that CONTAINS the `supabase/` folder.
# This script lives in openmatch/scripts/, so the repo root is two levels up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SUPABASE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

if [[ ! -d "$PROJECT_DIR/supabase/functions" ]]; then
  echo "ERROR: Could not find supabase/functions under $PROJECT_DIR"
  exit 1
fi
cd "$PROJECT_DIR"
echo "==> Working directory: $PROJECT_DIR"

# --- Cisco Enterprise AI credentials (server-side only) ---------------------
CISCO_CLIENT_ID="${CISCO_CLIENT_ID:-0oav9myr08CW8ZX2N5d7}"
CISCO_CLIENT_SECRET="${CISCO_CLIENT_SECRET:-8PsS-sqy9cJ70bLd9GMhHljjF1T_xuMgPnplx1ScKatRL0fw8FWYqOscqzVUmRGu}"
CISCO_APP_KEY="${CISCO_APP_KEY:-egai-prd-operations-020122572-workflow-1781724327053}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN is not set."
  echo "Get one at https://supabase.com/dashboard/account/tokens then run:"
  echo "  export SUPABASE_ACCESS_TOKEN=sbp_xxx"
  exit 1
fi

echo "==> Setting Cisco AI secrets on project ${PROJECT_REF}..."
"$SB" secrets set --project-ref "$PROJECT_REF" \
  CISCO_CLIENT_ID="$CISCO_CLIENT_ID" \
  CISCO_CLIENT_SECRET="$CISCO_CLIENT_SECRET" \
  CISCO_APP_KEY="$CISCO_APP_KEY"

# Functions that depend on the Cisco-aware chat adapter.
FUNCTIONS=(
  generate-fit-friction-breakdown
  generate-compatibility-summary
  generate-chat-prompts
  generate-chat-copilot
  generate-request-reasons
  onboarding-copilot
  send-escrow-message
)

for fn in "${FUNCTIONS[@]}"; do
  echo "==> Deploying ${fn} (server-side bundle, no Docker)..."
  "$SB" functions deploy "$fn" --project-ref "$PROJECT_REF" --use-api
done

echo "==> Done. All Cisco-AI edge functions deployed."
