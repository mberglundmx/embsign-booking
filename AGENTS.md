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
- **Workers Builds commands**: use `node cloudflare/worker/scripts/deploy-with-branch-d1.mjs --deploy-mode=versions-upload` for preview and `--deploy-mode=deploy` for production.
- **Local D1 migrations**: run `npm run d1:migrate:local` in `cloudflare/worker/` before local API tests.
- **Frontend unit tests**: run `npx vitest run --dir tests` in `frontend/`. The default `npm run test` / `npx vitest run` will also pick up Playwright spec files which causes an error; use `--dir tests` to scope to unit tests only.
- **Frontend build**: `npm run build` in `frontend/`.
- **Playwright E2E tests**: `npm run test:ui` in `frontend/`. Requires `npx playwright install` first. The Playwright config sets `VITE_USE_MOCKS=true` so no backend is needed.
