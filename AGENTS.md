# AGENTS.md

## Cursor Cloud specific instructions

This is a BRF Laundry Booking System with a Python/FastAPI backend and a Vite/Alpine.js frontend.

### Services

| Service | Command | Port |
|---|---|---|
| Backend (FastAPI) | `CSV_URL="" uvicorn app.main:app --port 8000 --host 0.0.0.0` | 8000 |
| Frontend (Vite) | `VITE_API_BASE=http://localhost:8000 npm run dev` (in `frontend/`) | 5173 |

### Important caveats

- **`CSV_URL` handling**: The `CSV_URL` and `GITHUB_TOKEN` secrets are injected into the environment. The backend converts `github.com` web URLs to GitHub API URLs automatically. When running `pytest`, set `CSV_URL=""` to skip RFID cache loading (tests use in-memory fixtures instead). When running the dev server, the real CSV_URL works fine if the token is valid.
- **Seeding test data**: The SQLite DB (`app.db`) starts empty. Apartments are auto-created on RFID login. For resources, insert manually:
  ```python
  python3 -c "
  import sqlite3
  conn = sqlite3.connect('app.db')
  conn.execute('INSERT OR IGNORE INTO resources (id, name, booking_type, is_active, price_cents, is_billable) VALUES (1, \"Tvättstuga 1\", \"time-slot\", 1, 0, 0)')
  conn.commit(); conn.close()
  "
  ```
  For POS mode, set `VITE_RFID_UID` to a real UID from the CSV (e.g., `00000003666340236` for apartment 1-LGH1013/1201).
- **Backend tests**: Run `CSV_URL="" pytest` from the repo root. Tests use in-memory SQLite and override the DB dependency, so no seeding is needed.
- **Frontend unit tests**: Run `npx vitest run --dir tests` in `frontend/`. The default `npm run test` / `npx vitest run` will also pick up Playwright spec files which causes an error; use `--dir tests` to scope to unit tests only.
- **Frontend build**: `npm run build` in `frontend/`.
- **Playwright E2E tests**: `npm run test:ui` in `frontend/`. Requires `npx playwright install` first. The Playwright config sets `VITE_USE_MOCKS=true` so no backend is needed.
- **`~/.local/bin` on PATH**: pip installs CLI tools (uvicorn, pytest, etc.) to `~/.local/bin`. Ensure it is on `PATH` (already added in the update script).
