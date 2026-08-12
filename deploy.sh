#!/usr/bin/env bash
# The only blessed way to ship shelfie-jg. Validates the main character FIRST,
# so a missing/broken critic.glb aborts before anything reaches the live site,
# then deploys the repo root to production. Run: ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "→ validating main character…"
node scripts/validate-critic.mjs

echo "→ deploying to shelfie-jg…"
netlify deploy --prod --dir . --site c1677cd8-337d-4500-879c-3aed0433fe67
