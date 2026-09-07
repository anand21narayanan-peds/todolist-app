# todolist-app

A cute to-do list built as a work breakdown rather than a flat list: up to
**4 goals**, **4 systems** per goal, and **4 tasks** per system — a ceiling of 64.

Nothing above task level is ever ticked by hand. A system completes when all its
tasks do, a goal when all its systems do, so progress is computed upward from the
checkboxes. Each task can carry a `done when` clause, which makes "finished" a
fact rather than a feeling.

Plain HTML/CSS/JS in a single file — no build step, no dependencies. Boards are
saved to `localStorage` in the visitor's own browser.

## Layout

```
wrangler.jsonc   # worker name + assets config
package.json     # present so the build's install step has something to run
public/
  index.html     # everything served publicly lives here
```

Two things about this layout are deliberate:

- **The config lives at the repo root**, so `wrangler deploy` finds it without
  Cloudflare needing a "root directory" build setting. One less dashboard field
  to get wrong.
- **Served files live in `public/`**, not at the root. If `assets.directory`
  pointed at the root, `wrangler.jsonc`, `package.json`, and anything npm
  generates during the build would all be published as public assets too.

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

There is nothing to install or build. Open `public/index.html` in a browser, or
serve the folder:

```sh
python3 -m http.server -d public 8000
```

To check a change deploys before pushing:

```sh
npx wrangler deploy --dry-run
```

It should report reading exactly **1 file** from `public`. A higher count means
config files are leaking into the published assets.
