#!/usr/bin/env bash
# MAKO CHAT — one-time server initialization.
#
# WHAT THIS DOES
#   1. Checks that `.env` exists (it holds the identity + database password).
#   2. Runs the official Synapse container once in "generate" mode, which
#      creates the server's signing keys. WHY: a Matrix server cryptographically
#      signs every event it produces; the key files ARE its identity. Losing
#      them loses the server's history, so they live in data/ (backed up).
#   3. Renders data/synapse/homeserver.yaml from homeserver.template.yaml,
#      substituting .env values plus a freshly generated registration secret
#      (used ONLY on the server, by the admin CLI).
#
# RUN THIS ON THE SERVER:   bash first-run.sh
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="matrixdotorg/synapse:v1.164.2"    # keep in sync with docker-compose.yml

if [ ! -f .env ]; then
  echo "ERROR: .env not found. First:  cp .env.example .env   then edit it."
  exit 1
fi
# shellcheck disable=SC1091
source .env
: "${SERVER_NAME:?SERVER_NAME missing in .env}"
: "${PUBLIC_BASEURL:?PUBLIC_BASEURL missing in .env}"
: "${POSTGRES_USER:?POSTGRES_USER missing in .env}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing in .env}"
: "${POSTGRES_DB:?POSTGRES_DB missing in .env}"

mkdir -p data/synapse
chmod 700 data/synapse

echo "==> [1/3] Generating Synapse signing keys (official container, one-shot)..."
docker run --rm \
  -v "$(pwd)/data/synapse:/data" \
  -e SYNAPSE_SERVER_NAME="$SERVER_NAME" \
  -e SYNAPSE_REPORT_STATS=no \
  "$IMAGE" generate

# The generate step names the signing key after the server (e.g. mako.signing.key).
# Be defensive: if Synapse ever changes that name, use whatever it made.
SIGNING_KEY="${SERVER_NAME}.signing.key"
if [ ! -f "data/synapse/${SIGNING_KEY}" ]; then
  FOUND="$(ls data/synapse/*.signing.key 2>/dev/null | head -n1 || true)"
  if [ -z "$FOUND" ]; then
    echo "ERROR: no signing key generated — see the docker output above."
    exit 1
  fi
  SIGNING_KEY="$(basename "$FOUND")"
  echo "    (note: signing key file is '${SIGNING_KEY}' — using that name)"
fi

echo "==> [2/3] Rendering homeserver.yaml from the template..."
# WHY: the live config contains a database password + registration secret.
# The template keeps those out of git; sed plants the real values here.
REGISTRATION_SECRET="$(openssl rand -hex 32)"
sed -e "s|__SERVER_NAME__|$SERVER_NAME|g" \
    -e "s|__PUBLIC_BASEURL__|$PUBLIC_BASEURL|g" \
    -e "s|__POSTGRES_USER__|$POSTGRES_USER|g" \
    -e "s|__POSTGRES_PASSWORD__|$POSTGRES_PASSWORD|g" \
    -e "s|__POSTGRES_DB__|$POSTGRES_DB|g" \
    -e "s|__REGISTRATION_SECRET__|$REGISTRATION_SECRET|g" \
    -e "s|__SIGNING_KEY__|$SIGNING_KEY|g" \
    homeserver.template.yaml > data/synapse/homeserver.yaml
chmod 600 data/synapse/homeserver.yaml

echo "==> [3/3] Done. Next steps:"
echo "    docker compose up -d"
echo "    curl http://localhost:8008/health        # should answer: OK"
echo "    Then create the first admin account — deploy.md step 6."
