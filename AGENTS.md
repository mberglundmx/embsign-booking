# AGENTS.md

## Cursor Cloud specific instructions

This is a BRF Laundry Booking System on Cloudflare stack:

- Backend: Cloudflare Worker (`cloudflare/worker`)
- Database: Cloudflare D1
- Frontend: Cloudflare Pages (`frontend`)

### Services

| Service | Command | Port |
|---|---|---|
| Worker API (local) | `npm run dev` (in `cloudflare/worker/`) | 8787 |
| Frontend (Vite) | `npm run dev` (in `frontend/`) | 5173 |
| Frontend (Pages local) | `npm run build && npx wrangler pages dev dist` (in `frontend/`) | 8788 |

### Important caveats

- **D1 binding in Cloudflare builds**: root `wrangler.jsonc` uses `${D1_DATABASE_ID}`. If you run `wrangler versions upload` directly, set `D1_DATABASE_ID`; if you run `npm run deploy:auto-d1`, the script resolves/injects `database_id` automatically.
- **Branch D1 auto-provision**: `cd cloudflare/worker && npm run deploy:auto-d1` runs `d1 list` and creates DB only if missing. Production branches use `D1_DATABASE_NAME` (default `brf-booking-d1`), others use `booking-pr-<branch-slug>`.
- **PR-based naming**: in preview mode the deploy script prefers PR IDs and can infer PR number from refs like `refs/pull/123/head` to name D1 as `booking-pr-pr-123`.
- **Branch fallback**: if branch env vars are missing in Workers Builds, deploy-mode `deploy` falls back to `main` (or first in `PRODUCTION_BRANCHES`), and `versions-upload` falls back to `preview-<commit-sha>`.
- **PR-based preview naming**: in `versions-upload`, `CF_PAGES_PULL_REQUEST_ID` is prioritized and generates `pr-<id>` for stable preview D1 reuse per PR.
- **Workers Builds commands**: use `node cloudflare/worker/scripts/deploy-with-branch-d1.mjs --deploy-mode=versions-upload` for preview and `--deploy-mode=deploy` for production.
- **Vars forwarding in deploy script**: auto-deploy script forwards selected build env vars into runtime `vars` (e.g. `TURNSTILE_SITE_KEY`, `ROOT_DOMAIN`) via generated wrangler config.
- **Turnstile setup**: set both `TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET` (server verification) in Cloudflare Worker vars/secrets for BRF registration captcha.
- **Captcha fallback policy**: frontend blocks registration when captcha is not configured; only enable manual token fallback explicitly for local dev (`VITE_CAPTCHA_MANUAL_FALLBACK=true` or `DEV_CAPTCHA_BYPASS=true`).
- **Temporary no-email mode**: if `RESEND_API_KEY`/`EMAIL_FROM` are missing, registration still succeeds, skips email delivery, and uses temporary admin password `abc123`.
- **Local D1 migrations**: run `npm run d1:migrate:local` in `cloudflare/worker/` before starting the worker or running local API tests. Migrations are idempotent.
- **Local dev quick start**: 1) `cd cloudflare/worker && npm run d1:migrate:local && npm run dev` (Worker at :8787), 2) `cd frontend && npm run dev` (Vite at :5173, proxies `/api` to :8787).
- **Create test tenant locally**: `curl -X POST http://127.0.0.1:8787/api/public/register -H 'Content-Type: application/json' -d '{"subdomain":"test-brf","association_name":"Test","email":"x@x.se","organization_number":"0000000000","captcha_token":"dev-ok"}'`. Then open `http://localhost:5173/test-brf` and log in with `admin` / `abc123`.
- **Prettier formatting**: existing code on main may have formatting drift; run `npm run format` in `frontend/` before `format:check` if you see failures not caused by your changes.

### Lint, format & test

| Scope | Command | Notes |
|---|---|---|
| Frontend lint | `npm run lint` (in `frontend/`) | ESLint flat config |
| Frontend format | `npm run format:check` (in `frontend/`) | Fix: `npm run format` |
| Frontend unit tests | `npm run test` (in `frontend/`) | Uses `--dir tests` to exclude Playwright specs |
| Frontend coverage | `npm run test:coverage` (in `frontend/`) | v8 coverage; thresholds at 50% |
| Frontend build | `npm run build` (in `frontend/`) | |
| Frontend E2E | `npm run test:ui` (in `frontend/`) | Requires `npx playwright install --with-deps chromium`. Uses `VITE_USE_MOCKS=true`, no backend needed. E2E tests use tenant path `/demo-brf` |
