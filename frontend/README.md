# Frontend

## Starta lokalt

```bash
npm install
npm run dev
```

Öppna `http://localhost:5173`.

Multi-tenant:

- Öppna gärna med tenant i URL, t.ex. `http://localhost:5173/min-brf`.
- Om tenant saknas visas tenant-väljare i inloggningsvyn.

För backend-anslutning:

- `VITE_API_BASE` (standard: `/api`)
- `VITE_RFID_UID` (demo-UID för POS-login)
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
