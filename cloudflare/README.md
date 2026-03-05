# Cloudflare-arkitektur (Worker + D1 + Pages)

Detta repo innehåller nu en Cloudflare-stack med:

- **Backend** i `cloudflare/worker/` (Cloudflare Worker).
- **Databas** i D1 med migrationer i `cloudflare/worker/migrations/`.
- **Frontend** i `frontend/` för deploy till Cloudflare Pages.

## Multi-tenant

- Tenant/BRF identifieras med `BRF_ID` (tenant-id), exempel:
  - `https://bokning.example.se/min-brf`
- Frontend skickar tenant vidare till backend via headern `X-BRF-ID`.
- Om ingen tenant är vald visas tenant-väljare i inloggningsvyn.

## Onboarding av ny BRF

Skapa tenant:

`POST /api/public/tenants`

Body:

`{"tenant_id":"min-brf","name":"BRF Min BRF"}`

Svar innehåller genererat admin-lösenord:

`{"tenant_id":"min-brf","admin_apartment_id":"admin","admin_password":"..."}`

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
3. `npx wrangler d1 migrations apply brf-booking-d1 --local`
4. `npx wrangler dev`

Frontend:

1. `cd frontend`
2. `npm install`
3. `npm run build`
4. `npx wrangler pages dev dist`

## Deploy

Backend:

- `cd cloudflare/worker && npx wrangler deploy`

Frontend:

- `cd frontend && npm run build && npx wrangler pages deploy dist`

> Sätt korrekt `database_id` i `cloudflare/worker/wrangler.toml` innan deploy.
