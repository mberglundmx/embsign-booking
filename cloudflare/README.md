# Cloudflare-arkitektur (Worker + D1 + Pages)

Detta repo innehåller nu en Cloudflare-stack med:

- **Backend** i `cloudflare/worker/` (Cloudflare Worker).
- **Databas** i D1 med migrationer i `cloudflare/worker/migrations/`.
- **Frontend** i `frontend/` för deploy till Cloudflare Pages.

## Multi-tenant

- Tenant/BRF identifieras primärt via subdomän:
  - `https://foo.bokningsportal.app` ⇒ tenant/BRF-ID = `foo`
- Backend läser tenant i denna ordning:
  1. Header `X-BRF-ID`
  2. Query (`brf_id` / `brf`)
  3. Subdomän från hostnamn
- Rootdomänen (`https://bokningsportal.app/`) fungerar som landningssida.

## Onboarding av ny BRF (landningssida)

1) Kontrollera om subdomän är ledig:

`GET /api/public/subdomain-availability?subdomain=min-brf`

2) Registrera BRF:

`POST /api/public/register`

Body:

`{"subdomain":"min-brf","association_name":"BRF Min BRF","email":"styrelsen@brf.se","organization_number":"7696XXXXXX","captcha_token":"..."}`

Vid lyckad registrering skickas admin-login/lösenord via e-post.

> För lokal utveckling kan `DEV_CAPTCHA_BYPASS=true` och `captcha_token=dev-ok` användas.

## Konfigurationsparametrar i databas

Miljövariabler som var backend-specifika flyttas till tenant-konfiguration i D1:

- Läs: `GET /api/admin/config`
- Uppdatera: `PUT /api/admin/config`

Exempelnycklar:

- `csv_url`
- `github_token`
- `config_url`
- `session_ttl_seconds`

## Lokal körning med Wrangler

Backend:

1. `cd cloudflare/worker`
2. `npm install`
3. `npm run d1:migrate:local`
4. `npm run dev`

Frontend:

1. `cd frontend`
2. `npm install`
3. `npm run build`
4. `npx wrangler pages dev dist`

## Deploy

Backend:

- `cd cloudflare/worker && npm run deploy`
- `cd cloudflare/worker && npm run deploy:auto-d1` (rekommenderat i Cloudflare Builds; skapar/återanvänder D1 och kör `wrangler versions upload`)
- `cd cloudflare/worker && npm run deploy:auto-d1:deploy` (samma D1-logik men med `wrangler deploy`)
- från repo-root: `npx wrangler versions upload` fungerar bara om `D1_DATABASE_ID` redan är satt.

Cloudflare Workers Builds (repo-kopplad):

- Preview deploy command: `node cloudflare/worker/scripts/deploy-with-branch-d1.mjs --deploy-mode=versions-upload`
- Production deploy command: `node cloudflare/worker/scripts/deploy-with-branch-d1.mjs --deploy-mode=deploy`

Frontend:

- `cd frontend && npm run build && npx wrangler pages deploy dist`

## Viktigt: Workers Builds vs Pages Builds

- En **Workers Build** (som kör `npx wrangler versions upload`) deployar bara Worker (`*.workers.dev`).
- Den deployar **inte** frontend till `*.pages.dev`.
- För `pages.dev` behöver ni en **separat Cloudflare Pages-projektkoppling** mot samma repo.

### Rekommenderad Pages-konfiguration

I Cloudflare Pages (nytt projekt):

- Framework preset: `None`
- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`

Detta ger en separat `*.pages.dev`-preview per branch/commit.

Frontend använder nu en Pages Function-proxy:

- `frontend/functions/api/[[path]].js`
- proxar `/api/*` till branch-specifik Worker-preview (`*.workers.dev`)
- kan override:as med `WORKER_PREVIEW_URL` i Pages env vars

Det gör att Pages-preview och Worker-preview kommunicerar per branch utan manuell URL-hantering i frontend.

### Viktigt för Cloudflare deploy (fix för tidigare build-fel)

- Root-konfigurationen `wrangler.jsonc` innehåller D1-binding via env-variabel: `${D1_DATABASE_ID}`.
- Om ni kör `npx wrangler versions upload` direkt behöver `D1_DATABASE_ID` vara satt i build-miljön.
- Om ni kör `npm run deploy:auto-d1` behövs inte detta; scriptet injicerar konkret `database_id` automatiskt.
- Lokalt används separat `cloudflare/worker/wrangler.local.toml`.

### Branch-specifik D1 (auto-provisionering)

Script: `cloudflare/worker/scripts/deploy-with-branch-d1.mjs` (körs via `npm run deploy:auto-d1` i `cloudflare/worker/`).

Funktion:

- Läser branch från `CF_PAGES_BRANCH` / `CF_BRANCH` / `GITHUB_REF_NAME` (eller `--branch=...`).
- I preview/`versions-upload` prioriteras `CF_PAGES_PULL_REQUEST_ID` för namngivning (`pr-<id>`), så samma PR återanvänder samma D1.
- Om branch saknas i buildmiljön används fallback:
  - `deploy`-läge: första värdet i `PRODUCTION_BRANCHES` (default `main`)
  - `versions-upload`-läge: `preview-<commit-sha>`
- Väljer DB-namn:
  - produktionsbranch (`main,master,production,prod`): `brf-booking-d1` (kan ändras via `D1_DATABASE_NAME`)
  - övriga brancher: `booking-pr-<branch-slug>` (kan ändras via `D1_DATABASE_PREFIX`)
- Kör `wrangler d1 list` och:
  - återanvänder DB om den redan finns
  - skapar DB om den saknas (gäller även produktion enligt önskat beteende)
- Skapar temporär wrangler-konfig med konkret `database_id` så deploy inte faller på `code: 10021`.

Exempel:

- Dry-run: `npm run deploy:auto-d1 -- --dry-run --branch=feature/x`
- Deploy: `npm run deploy:auto-d1`
- Deploy (klassisk): `npm run deploy:auto-d1:deploy`
- Snabbtest lokalt (utan Cloudflare build-loggar): `CF_PAGES_PULL_REQUEST_ID=123 node cloudflare/worker/scripts/deploy-with-branch-d1.mjs --deploy-mode=versions-upload --dry-run`

Valfria env vars:

- `D1_DATABASE_PREFIX` (default `booking-pr`)
- `PRODUCTION_BRANCHES` (komma-separerad lista)
- `D1_DATABASE_NAME` (default `brf-booking-d1`, används för produktionsbranch)

### E-post/captcha-konfig i Worker (Dashboard secrets/vars)

Sätt följande secrets/vars i Cloudflare:

- `TURNSTILE_SITE_KEY` (publik site key till frontend via `/api/public/captcha-config`)
- `TURNSTILE_SECRET` (captcha-verifiering)
- `RESEND_API_KEY` (e-post via Resend)
- `EMAIL_FROM` (avsändaradress)
- `ROOT_DOMAIN` (t.ex. `bokningsportal.app`)

Om `TURNSTILE_SITE_KEY` saknas blockeras registreringsflödet i UI (förutom ev. dev-fallback när `DEV_CAPTCHA_BYPASS=true`).

> Sätt korrekt `database_id` i Worker-konfigurationen innan deploy.
