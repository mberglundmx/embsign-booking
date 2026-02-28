# Railway deployment (backend + frontend)

Detta repo kan köras på Railway med två separata services:

- `backend` (FastAPI, repo-rot)
- `frontend` (Vite, `frontend/`)

Konfig finns nu i kod:

- `/railway.json` (backend)
- `/frontend/railway.json` (frontend)

## Kan allt skapas automatiskt?

Kort svar:

- **Delvis automatiskt:** build/start/healthcheck styrs nu av filerna ovan.
- **Manuellt en gång:** du behöver normalt skapa/koppla två services i Railway-projektet.
- **Helt automatiskt för nya projekt:** publicera projektet som en Railway Template efter första uppsättningen.

## Snabb setup i Railway

1. Skapa ett nytt Railway-projekt.
2. Lägg till service `backend` från detta repo.
3. Lägg till service `frontend` från samma repo.
4. Sätt service-inställningar enligt nedan.

## Backend-service

- **Root Directory:** `/`
- **Railway Config File:** `/railway.json`
- **Public networking:** On
- **Miljövariabler:**
  - `FRONTEND_ORIGINS=https://<frontend-domain>`
  - `CSV_URL=` (tom om du inte använder extern CSV-källa)
  - `CONFIG_URL=` (valfri URL till `booking.yaml`; om tom försöker backend använda samma repo som `CSV_URL`)
  - `DATABASE_PATH=/data/app.db` (rekommenderas om du använder volume)

Rekommenderat för SQLite:

- Lägg till en Railway Volume och montera den på `/data`.
- Sätt `DATABASE_PATH=/data/app.db`.

## Frontend-service

- **Root Directory:** `/frontend`
- **Railway Config File:** `/frontend/railway.json`
- **Public networking:** On
- **Miljövariabler:**
  - `VITE_API_BASE=https://<backend-domain>`
  - `VITE_USE_MOCKS=false`
  - `VITE_RFID_UID=UID123` (valfri demo-UID)

Viktigt för Vite: `VITE_*` läses vid build, så kör en redeploy om de ändras.

## Notering om monorepo

Railway läser inte configfilens path från Root Directory automatiskt. Därför är det viktigt att sätta absolut path för respektive service:

- backend: `/railway.json`
- frontend: `/frontend/railway.json`
