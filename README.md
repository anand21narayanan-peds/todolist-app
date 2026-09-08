# todolist-app

A cute to-do list built as a work breakdown rather than a flat list: up to
**4 goals**, **4 systems** per goal, and **4 tasks** per system — a ceiling of 64.

Nothing above task level is ever ticked by hand. A system completes when all its
tasks do, a goal when all its systems do, so progress is computed upward from the
checkboxes. Each task can carry a `done when` clause, which makes "finished" a
fact rather than a feeling.

Data lives in **Supabase** (Postgres) behind a real login, so the same board
shows up on every device you sign in from, and updates live while you have it
open. The front end is plain HTML/CSS/JS — no framework, no build step.

## Layout

```
wrangler.jsonc     # Cloudflare Worker: static files only, no server code
schema.sql         # Postgres tables, RLS policies, cap triggers
public/
  index.html       # the whole app
  config.js        # your Supabase URL + anon key
```

There is no server of ours. The browser talks to Supabase directly, and
Cloudflare only hands over static files — which is why `wrangler.jsonc` has no
`main`, no bindings and no secrets.

## Data model

```
goals(id, user_id, name, position)
  systems(id, user_id, goal_id → goals.id, name, position)
    tasks(id, user_id, system_id → systems.id, title, dod, done, position)
prefs(user_id, sel, open)   -- which tab was open, which systems were expanded
```

No "percent complete" or "system is done" column exists: both are derived on
read, so two devices can never disagree about them.

`prefs` is why a phone and a laptop feel like the same app rather than two
copies — the selected goal and expanded systems travel with the account.

Three rules live in the database rather than the app, because that is the only
place they cannot be skipped:

- **Ownership** — row level security scopes every row to `auth.uid()`.
- **The 4/4/4 caps** — `BEFORE INSERT` triggers. Postgres can express "at most
  four children"; SQLite could not, which is why this moved out of app code.
- **Ordering** — `position` is assigned server-side and never sent by the client.

## Setting it up

**1. Create a Supabase project**, then open the **SQL Editor**, paste all of
`schema.sql`, and run it.

**2. Create your login.** Authentication → **Users** → *Add user*, with your
email and a password. Then in Authentication settings turn **"Allow new users to
sign up" off**, so the project stays yours alone. The app has no sign-up screen
by design.

**3. Fill in `public/config.js`** with the Project URL and the **anon** key from
Project Settings → API, and push. Cloudflare redeploys on its own.

Until step 3, the app loads and tells you what is missing rather than failing
silently.

### About the anon key

It is meant to be public — it ships in every Supabase web app and identifies the
project, not you. Row level security is what actually protects the data, which
is why most of `schema.sql` is policies. The **service_role** key is the
dangerous one: it bypasses RLS entirely. It must never appear in `public/`.

## Deploying to Cloudflare

1. **Workers & Pages → Create → Import a repository**, pick this repo.
2. **Worker name**: must match `name` in `wrangler.jsonc` (`todolist-app`).
3. **Build command**: empty. **Deploy command**: `npx wrangler deploy`.
4. **Root directory**: empty — the config is at the repo root.
5. **Production branch**: `main`.

## Developing

```sh
npm run dev      # serves public/ at http://localhost:8000
npm run check    # wrangler deploy --dry-run
```

It talks to your real Supabase project either way; there is nothing to run
locally besides a static file server.

## Notes

- The Supabase client is loaded with a dynamic `import()` inside a `try`. A
  static import that fails aborts the whole module and renders a blank page with
  no explanation; this way a CDN outage produces a message instead.
- Supabase pauses free-tier projects after about a week of inactivity. If the
  app cannot reach the database after a quiet spell, un-pause it in the
  dashboard.
