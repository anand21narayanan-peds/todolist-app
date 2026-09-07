# smallapps

Small, self-contained web apps for personal use. Each app lives in its own top-level folder as a static site (plain HTML/CSS/JS, no build step) so it can be deployed independently.

## Apps

- [`todo-list/`](./todo-list) — Cute to-do list built as a work breakdown: up to
  4 goals, 4 systems per goal, 4 tasks per system. Progress is computed upward
  from the task checkboxes, never set by hand. Saved to `localStorage`.

## Layout

Each app is one top-level folder holding its own `wrangler.jsonc`, and serves
static files from a `public/` subfolder:

```
todo-list/
  wrangler.jsonc   # worker name + assets config
  package.json     # present so the build's install step has something to run
  public/
    index.html     # everything served publicly lives here
```

Keeping the served files in `public/` matters: if `assets.directory` points at
the app folder itself, `wrangler.jsonc`, `package.json`, and anything npm
generates during the build all get published as public assets too.

## Deploying to Cloudflare (Workers Builds)

One Cloudflare Worker per app, all from this single repo:

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, pick this repo.
2. **Root directory**: the app's folder, e.g. `todo-list`.
3. **Build command**: leave empty. **Deploy command**: `npx wrangler deploy`.
4. **Production branch**: the branch the app's folder actually exists on.
5. In the app's `wrangler.jsonc`, `name` must exactly match the Worker's name in
   the dashboard, or the deploy targets the wrong Worker and the Git connection
   breaks.

Adding a new app later means a new top-level folder (with its own
`wrangler.jsonc` and `public/`) and one more Worker pointed at it.
