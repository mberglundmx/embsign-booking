# Design Spec - BRF Laundry Booking System

## Project Goal
Build a self-hosted laundry room booking system for a housing association (BRF). The system uses a Python backend (FastAPI) to handle all authentication and booking logic. SQLite is used for data storage (bookings and resources). Frontend is minimal, modern, and responsive using TailwindCSS and Alpine.js. The system supports RFID login for kiosks, apartment-based login for mobile, and an admin interface for managing bookings. Calendar is never directly exposed to users.

## System Philosophy
- Backend handles all business logic and auth
- Frontend is thin: only UI, no business logic
- Apartment identity only, no personal data
- POS or kiosk is a dumb browser
- Mobile is minimal, same API as kiosk
- Admin interface provides view and CRUD bookings
- SQLite in-memory for testing, file-based in production
- High test coverage: unit tests and end-to-end tests before deploy

## High-level Architecture
- RFID tag -> kiosk browser -> FastAPI backend -> SQLite DB (storage)
- Mobile browser -> backend -> SQLite DB
- Admin -> backend -> SQLite DB

## Components
### Backend (Python FastAPI)
Responsibilities:
- RFID authentication -> apartment ID -> session cookie
- Mobile login -> apartment ID + password -> session cookie
- Booking rules: max 1 booking per apartment per slot, prevent overlaps
- CRUD interface to SQLite DB for bookings and resources
- Admin-only endpoints for viewing all bookings
- In-memory cache of RFID -> apartment mappings from GitHub CSV
- Session timeout and logout handling
- High test coverage using pytest, SQLite in-memory DB for tests

### Database (SQLite)
- Stores bookings, resources, apartments, sessions
- Full constraints: unique bookings per slot, foreign keys
- In-memory during tests for isolation
- File-based in production (Railway)
- Backup via file copy

### Kiosk (POS terminal)
- Fullscreen browser
- Captures RFID input as keyboard HID
- Sends UID to backend (`/rfid-login`)
- Receives session cookie and booking UI
- Shows status: scanning, success, error, timeout
- Auto logout after inactivity, returns to home screen
- No local storage or business logic

### Mobile Client
- Web login using apartment ID + password
- Fetch available slots
- Create and cancel bookings via backend API
- Minimal frontend logic
- Uses same endpoints as kiosk

### Admin Interface
- Separate login
- View full booking calendar
- CRUD resources and bookings
- Only accessible via backend authentication

### GitHub CSV
- Maps RFID UID -> apartment ID
- Single source of truth
- Backend fetches at startup and refreshes periodically
- CSV format: `rfid_uid,lgh_id,active`
- Private repository, accessed with GitHub token

## Functional Requirements
- Each apartment corresponds to one account
- Backend validates UID is active and maps to apartment
- Booking API ensures slot availability
- Only one booking per apartment per slot
- Backend returns booking status to kiosk or mobile
- Admin can view and modify all bookings

## Backend Endpoints
- `POST /rfid-login` -> `{ uid: string }` -> session cookie + booking UI URL or error
- `POST /mobile-login` -> `{ apartment_id, password }` -> session cookie + booking UI URL or error
- `GET /slots` -> optional `resource_id/date` -> list of available slots
- `POST /book` -> `{ apartment_id, resource_id, start_time, end_time }` -> success or conflict or error
- `DELETE /cancel` -> `{ booking_id }` -> success or error
- `GET /admin/calendar` -> admin auth -> full booking data

## Security Requirements
- No personal data stored
- RFID UID only transmitted for login POST
- Rate limit login endpoints
- Reject unknown or inactive tags
- Admin auth required for CRUD and calendar
- Sessions expire after inactivity

## UI Behavior
- Kiosk: fullscreen, capture RFID, show status, auto logout
- Mobile: login, show available slots, book and cancel
- Admin: full calendar view, CRUD resources and bookings
- Frontend: TailwindCSS for styling, Alpine.js for interactivity, responsive
- Minimal frontend state, all logic on backend

## Admin and Data Management
- Admins can send notifications for specific bookings to selected administrators
- Users can register email and mobile number for communication when needed
- Property caretaker can remove user data via admin UI on move-out
- User ID remains, but password, email, and phone are erased

## Billing and Reporting
- Reporting for billing is available
- Some bookable resources have a price
- Booking objects can be marked as billable

## Operational Constraints
- Multiple kiosks supported simultaneously
- Backend restart reloads RFID cache
- SQLite sufficient for BRF scale (approx 50-100 apartments, 1-3 resources)
- Backend resilient to temporary failures

## Testing
- Unit tests (pytest) with in-memory SQLite DB
- Test RFID login, booking rules, session handling, edge cases
- End-to-end tests (Playwright or Selenium) for kiosk and mobile flows
- All unit tests run before any deploy

### CI: GitHub Actions
- Workflow runs on every push and pull request
- Unit tests must pass before deployment is allowed
- Use Python cache to speed up installs
- Fail fast on lint or unit test errors

## Deployment
- Railway hosting
- Environment variables: `GITHUB_TOKEN`, `CSV_URL`, `SESSION_SECRET`
- SQLite file in production, in-memory for tests
- Deploy only after GitHub Actions unit tests pass

### Railway Build and Deploy
- Railway project uses repo-based deployment
- Build command installs dependencies and runs tests
- Start command launches FastAPI app
- No deploy is triggered if GitHub Actions fails

## Performance Goals
- RFID scan to logged-in booking page < 500ms
- Booking lookup in-memory, O(1)
- Minimal latency, stable under multiple kiosks

## Code Quality Expectations
- Small codebase (approx 600-800 LOC)
- Clear separation backend and frontend
- Defensive error handling
- Logging for login attempts and bookings
- Easy to maintain by future BRF administrators

## Future Extensibility (do not implement yet)
- Multiple resources (bastu, guest apartment)
- Audit logging
- Usage statistics
- Access control integration (Axema or VAKA)