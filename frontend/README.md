# Frontend

## Starta lokalt

```bash
npm install
npm run dev
```

Öppna `http://localhost:5173`.

För backend-anslutning:
- `VITE_API_BASE` (t.ex. `http://localhost:8000`)
- `VITE_RFID_UID` (demo-UID för POS-login)
- `VITE_USE_MOCKS=true` för att köra med lokala mocks istället.

RFID i POS-läge:
- Skannern förväntas skriva som tangentbord och avslutas med Enter.
- Du kan också klistra in kod i RFID-fältet och trycka Enter.

## Tester

```bash
npm run test
npm run test:ui
```

Tips: kör `npm run test:ui:headed` för att se flödena visuellt.
