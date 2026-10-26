#!/usr/bin/env bash
#
# The deploy step Cloudflare Workers Builds runs.
#
# Why a script rather than a one-line deploy command: a build variable is not
# available when the Worker actually runs, and a Worker built from a repository
# has no obvious place in the dashboard to put a runtime secret. So the deploy
# copies each build secret into the Worker's runtime secrets, every time, and
# the list of names lives here in the repository instead of in a dashboard
# field nobody can review.
#
# Set it once as the project's deploy command:
#
#   bash scripts/ci-deploy.sh
#
# Adding a secret later is then two steps, both in the browser: add it under
# Settings -> Builds -> Variables and secrets, and add its name below.
#
# A name that is not set is skipped, so this works from the very first deploy,
# with nothing configured, through to all of them.

set -euo pipefail

SECRETS=(
  JWT_SECRET
  GDRIVE_CLIENT_ID
  GDRIVE_CLIENT_SECRET
  GDRIVE_REFRESH_TOKEN
  GDRIVE_FOLDER_ID
  GDRIVE_CREDENTIALS_JSON
  BREVO_API_KEY
  BREVO_SENDER_EMAIL
)

for name in "${SECRETS[@]}"; do
  # Unset and empty are both "not configured". Nothing is echoed: the value
  # goes down a pipe, so it never reaches the command line or the build log.
  if [ -z "${!name:-}" ]; then
    echo "skip   $name (not set)"
    continue
  fi
  printf '%s' "${!name}" | npx wrangler secret put "$name"
  echo "stored $name"
done

npx wrangler d1 migrations apply qa-platform --remote
npx wrangler deploy
