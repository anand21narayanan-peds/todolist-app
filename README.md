# todolist-app

A cute to-do list built as a work breakdown rather than a flat list: up to
**4 goals**, **4 systems** per goal, and **4 tasks** per system — a ceiling of 64.

Nothing above task level is ever ticked by hand. A system completes when all its
tasks do, a goal when all its systems do, so progress is computed upward from the
checkboxes. Each task can carry a `done when` clause, which makes "finished" a
fact rather than a feeling.

Boards live in a Cloudflare D1 database behind a single password login, so the
same board shows up on every device you sign in from. Plain HTML/CSS/JS on the
front end — no framework, no build step.

## Layout

```
wrangler.jsonc          # worker name, assets config, D1 binding
schema.sql              # database tables
src/index.js            # the Worker: auth + JSON API, falls through to assets
scripts/hash-password.mjs  # turns a password into the stored verifier
public/
  index.html            # the whole front end
```

Two things about this layout are deliberate:

- **The config lives at the repo root**, so `wrangler deploy` finds it without
  Cloudflare needing a "root directory" build setting. One less dashboard field
  to get wrong.
- **Served files live in `public/`**, not at the root. If `assets.directory`
  pointed at the root, `wrangler.jsonc`, `package.json`, and anything npm
  generates during the build would all be published as public assets too.

## Data model

Three tables, one row per thing, mirroring the goal → system → task shape:

```
goals(id, name, position)
  systems(id, goal_id → goals.id, name, position)
    tasks(id, system_id → systems.id, title, dod, done, position)
prefs(id, value)   -- which tab was open, which systems were expanded
```

Nothing stores a "percent complete" or a "system is done" flag: those are
derived on read, so two devices can never disagree about them. The 4/4/4 caps
are enforced in the Worker on every insert — a client that skips the UI still
cannot exceed them.

`prefs` is why a phone and a laptop feel like the same app rather than two
copies: the selected goal and the expanded systems travel with the account.

## Security

- The password is never stored. `APP_PASSWORD_HASH` holds a PBKDF2-SHA256
  verifier (210,000 iterations) that cannot be reversed.
- Login issues an HMAC-signed, `HttpOnly` `Secure` `SameSite=Lax` cookie. The
  signing key is derived from the password verifier, so changing the password
  invalidates every existing session automatically.
- Mutations also check the `Origin` header.
- The HTML shell is public; every byte of board data requires the session.

There is no brute-force lockout — PBKDF2 plus a delay on failure is the only
rate limiting. Use a long password.

## First-time setup

You need this once, from a machine with the repo checked out:

```sh
npx wrangler login

# 1. create the database, then paste the printed id into wrangler.jsonc
npx wrangler d1 create todolist-db

# 2. create the tables
npx wrangler d1 execute todolist-db --remote --file=./schema.sql

# 3. choose a password and store its verifier as a secret
node scripts/hash-password.mjs
npx wrangler secret put APP_PASSWORD_HASH
```

Until `database_id` is filled in and the secret is set, the API answers `503`
with a message saying which piece is missing.

To change the password later, re-run step 3. Every device is signed out.

## Deploying to Cloudflare (Workers Builds)

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, pick this repo.
2. **Worker name**: must exactly match `name` in `wrangler.jsonc` (`todolist-app`).
   A mismatch deploys to a different Worker and breaks the Git connection.
3. **Build command**: leave empty. **Deploy command**: `npx wrangler deploy`.
4. **Root directory**: leave empty — the config is at the repo root.
5. **Production branch**: `main`.
6. **API token**: needs Workers permissions — the "Edit Cloudflare Workers"
   template works. A token scoped to something else fails with a permissions note.

## Developing

Run the Worker and a local database:

```sh
# a local-only password, never committed (.dev.vars is gitignored)
node scripts/hash-password.mjs        # paste as APP_PASSWORD_HASH=... into .dev.vars
npx wrangler d1 execute todolist-db --local --file=./schema.sql
npx wrangler dev
```

To check a change deploys before pushing:

```sh
npx wrangler deploy --dry-run
```

It should report reading exactly **1 file** from `public`. A higher count means
config files are leaking into the published assets.
