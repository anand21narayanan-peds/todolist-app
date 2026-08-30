# smallapps

Small, self-contained web apps for personal use. Each app lives in its own top-level folder as a static site (plain HTML/CSS/JS, no build step) so it can be deployed independently.

## Apps

- [`todo-list/`](./todo-list) — Cute 10-task to-do list with completion animations.

## Deploying to Cloudflare Pages

You can host every app from this one repo without splitting into separate repos:

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Set **Build output directory** (a.k.a. root directory) to the app's folder, e.g. `todo-list`.
3. Leave the build command empty (these are static files).
4. Repeat steps 1–3 for each app, creating one Cloudflare Pages project per folder. Each gets its own `*.pages.dev` URL (and you can attach a custom subdomain).

Adding a new app later just means adding a new top-level folder and creating one more Pages project pointed at it — no repo restructuring needed.
