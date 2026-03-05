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
- eller från repo-root: `npx wrangler versions upload`

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
- Sätt `D1_DATABASE_ID` i Cloudflare Worker build environment (per environment där ni kör previews/production).
- Lokalt används separat `cloudflare/worker/wrangler.local.toml`.

### E-post/captcha-konfig i Worker (Dashboard secrets/vars)

Sätt följande secrets/vars i Cloudflare:

- `TURNSTILE_SECRET` (captcha-verifiering)
- `RESEND_API_KEY` (e-post via Resend)
- `EMAIL_FROM` (avsändaradress)
- `ROOT_DOMAIN` (t.ex. `bokningsportal.app`)

> Sätt korrekt `database_id` i Worker-konfigurationen innan deploy.
