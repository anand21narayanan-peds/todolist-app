#!/usr/bin/env bash
#
# One-command setup for a fresh Cloudflare account.
#
#   npm run setup
#
# Creates the D1 database, writes its id into wrangler.jsonc, creates the
# tables, and stores your password verifier as a secret. Safe to re-run:
# every step checks for what already exists before doing anything.

set -euo pipefail

DB_NAME="todolist-db"
WRANGLER="npx --yes wrangler@4"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

cd "$(dirname "$0")/.."

# --- 0. account ------------------------------------------------------------
say "1/5  Checking your Cloudflare login"
if ! $WRANGLER whoami >/dev/null 2>&1 || $WRANGLER whoami 2>&1 | grep -q "not authenticated"; then
  note "Opening a browser to sign in to Cloudflare…"
  $WRANGLER login
else
  note "Already signed in."
fi

# --- 1. database -----------------------------------------------------------
say "2/5  Finding or creating the '$DB_NAME' database"
db_id() {
  $WRANGLER d1 list --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{ const row=(JSON.parse(s)||[]).find(d=>d.name===process.argv[1]);
             if(row) process.stdout.write(row.uuid||row.database_id||""); }catch{}
      })' "$DB_NAME"
}

ID="$(db_id || true)"
if [ -z "$ID" ]; then
  note "Creating it…"
  $WRANGLER d1 create "$DB_NAME" >/dev/null
  ID="$(db_id || true)"
else
  note "It already exists."
fi

if [ -z "$ID" ]; then
  echo "Could not determine the database id. Run '$WRANGLER d1 list' and set it by hand." >&2
  exit 1
fi
note "id: $ID"

# --- 2. wire it into the config -------------------------------------------
say "3/5  Pointing wrangler.jsonc at it"
node scripts/set-db-id.mjs "$ID" | sed 's/^/  /'

# --- 3. tables -------------------------------------------------------------
say "4/5  Creating the tables"
$WRANGLER d1 execute "$DB_NAME" --remote --file=./schema.sql -y >/dev/null
note "goals, systems, tasks, prefs are ready."

# --- 4. password -----------------------------------------------------------
say "5/5  Setting your password"
if $WRANGLER secret list 2>/dev/null | grep -q APP_PASSWORD_HASH; then
  note "A password is already set."
  printf '  Replace it? [y/N] '
  read -r reply
  case "$reply" in [Yy]*) ;; *) note "Keeping the existing one."; SKIP_PW=1 ;; esac
fi

if [ -z "${SKIP_PW:-}" ]; then
  HASH="$(node scripts/hash-password.mjs)"
  printf '%s' "$HASH" | $WRANGLER secret put APP_PASSWORD_HASH >/dev/null
  note "Stored. Only the verifier was uploaded — never the password itself."
fi

say "Done."
note "Commit the wrangler.jsonc change so the Git build uses the same database:"
note "    git add wrangler.jsonc && git commit -m 'Point at the D1 database' && git push"
note ""
note "Then deploy:  npx wrangler deploy"
printf '\n'
