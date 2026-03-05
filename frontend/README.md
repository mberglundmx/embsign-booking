# Frontend

## Starta lokalt

```bash
npm install
npm run dev
```

Öppna `http://localhost:5173`.

Multi-tenant:

- Root (`/`) visar landningssida med:
  - info om tjänsten
  - dropdown för att välja BRF och gå till rätt subdomän
  - registreringsflöde (subdomän, e-post, org.nr, captcha)
- På tenant-subdomän visas inloggningsvyn direkt.

För backend-anslutning:

- `VITE_API_BASE` (standard: `/api`)
- `VITE_ROOT_DOMAIN` (standard: `bokningsportal.app`)
- `VITE_RFID_UID` (demo-UID för POS-login)
- `VITE_TURNSTILE_SITE_KEY` (site key för Turnstile-widget i registreringsflödet)
- `VITE_USE_MOCKS=true` för att köra med lokala mocks istället.

RFID i POS-läge:

- Skannern förväntas skriva som tangentbord och avslutas med Enter.
- Du kan också klistra in kod i RFID-fältet och trycka Enter.

## Tester

```bash
npm run test
npm run test:coverage
npm run test:ui
```

Tips: kör `npm run test:ui:headed` för att se flödena visuellt.

## Lint och formatering

```bash
npm run lint
npm run format:check
```

Auto-fixa lokalt:

```bash
npm run lint:fix
npm run format
```

## Cloudflare Pages

```bash
npm run build
npm run cf:pages:dev
```

Deploy:

```bash
npm run build
npm run cf:pages:deploy
```

### Observera

- Worker-deploy (`wrangler versions upload`) publicerar bara API:t på `workers.dev`.
- För `pages.dev` måste frontend också vara kopplad i ett separat **Cloudflare Pages-projekt**:
  - Root directory: `frontend`
  - Build command: `npm ci && npm run build`
  - Output directory: `dist`

Pages Function (`frontend/functions/api/[[path]].js`) proxar `/api/*` till rätt Worker-preview per branch.

Valfria env vars för att styra proxy-målet:

- `WORKER_PREVIEW_URL` (full URL, högst prioritet)
- `WORKER_NAME` (default `embsign-booking`)
- `WORKER_ACCOUNT_SUBDOMAIN` (default `embsign`)
