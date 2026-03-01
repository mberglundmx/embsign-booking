import logging

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import (
    RFID_CACHE,
    check_rate_limit,
    create_session,
    ensure_apartment,
    get_session,
    hash_password,
    load_rfid_cache,
    lookup_rfid,
    verify_password,
)
from .booking import (
    admin_calendar,
    can_access_resource,
    cancel_booking,
    create_booking,
    list_full_day_availability_range,
    list_slots,
)
from .config import CSV_URL, DATABASE_PATH, FRONTEND_ORIGINS, GITHUB_TOKEN
from .db import create_connection, get_db, init_db
from .resource_config import load_booking_objects
from .schemas import (
    BookRequest,
    BookingsResponse,
    BookingResponse,
    CancelRequest,
    LoginResponse,
    MobileLoginRequest,
    MobilePasswordUpdateRequest,
    RFIDLoginRequest,
    ResourcesResponse,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s",
)

app = FastAPI(title="BRF Laundry Booking")
logger = logging.getLogger(__name__)

origins = [origin.strip() for origin in FRONTEND_ORIGINS.split(",") if origin.strip()]
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.on_event("startup")
def startup() -> None:
    conn = create_connection(DATABASE_PATH)
    try:
        init_db(conn)
        load_rfid_cache()
        load_booking_objects(conn)
        logger.info(
            "Config CSV_URL=%s GITHUB_TOKEN=%s DATABASE_PATH=%s",
            "set" if bool(CSV_URL) else "missing",
            "set" if bool(GITHUB_TOKEN) else "missing",
            DATABASE_PATH,
        )
    finally:
        conn.close()


def require_session(
    session: str = Cookie(default=""),
    conn=Depends(get_db),
):
    data = get_session(conn, session)
    if data is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    return data


@app.post("/rfid-login", response_model=LoginResponse)
def rfid_login(payload: RFIDLoginRequest, response: Response, conn=Depends(get_db)):
    check_rate_limit()
    logger.info("RFID login attempt uid=%s cache_size=%d", payload.uid, len(RFID_CACHE))
    entry = lookup_rfid(payload.uid)
    if entry is None or not entry.active:
        raise HTTPException(status_code=401, detail="invalid_rfid")
    ensure_apartment(conn, entry)
    row = conn.execute(
        "SELECT * FROM apartments WHERE id = ? AND is_active = 1",
        (entry.apartment_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="inactive_apartment")
    token = create_session(conn, entry.apartment_id, is_admin=False)
    response.set_cookie("session", token, httponly=True, samesite="none", secure=True)
    return LoginResponse(booking_url="/booking", apartment_id=entry.apartment_id)


@app.post("/mobile-login", response_model=LoginResponse)
def mobile_login(payload: MobileLoginRequest, response: Response, conn=Depends(get_db)):
    check_rate_limit()
    row = conn.execute(
        "SELECT * FROM apartments WHERE id = ? AND is_active = 1",
        (payload.apartment_id,),
    ).fetchone()
    if row is None or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    token = create_session(conn, payload.apartment_id, is_admin=False)
    response.set_cookie("session", token, httponly=True, samesite="none", secure=True)
    return LoginResponse(booking_url="/booking", apartment_id=payload.apartment_id)


@app.post("/mobile-password")
def update_mobile_password(
    payload: MobilePasswordUpdateRequest,
    session=Depends(require_session),
    conn=Depends(get_db),
):
    new_password = payload.new_password.strip()
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="password_too_short")
    result = conn.execute(
        "UPDATE apartments SET password_hash = ? WHERE id = ?",
        (hash_password(new_password), session["apartment_id"]),
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="apartment_not_found")
    conn.commit()
    return {"status": "ok"}


@app.get("/slots")
def get_slots(
    resource_id: int | None = None,
    date: str | None = None,
    session=Depends(require_session),
    conn=Depends(get_db),
):
    return {
        "slots": list_slots(
            conn,
            resource_id,
            date,
            apartment_id=session["apartment_id"],
            is_admin=bool(session["is_admin"]),
        )
    }


@app.get("/availability-range")
def get_availability_range(
    resource_id: int,
    start_date: str,
    end_date: str,
    session=Depends(require_session),
    conn=Depends(get_db),
):
    try:
        availability = list_full_day_availability_range(
            conn,
            resource_id,
            start_date,
            end_date,
            apartment_id=session["apartment_id"],
            is_admin=bool(session["is_admin"]),
        )
    except ValueError as exc:
        if str(exc) in {"invalid_date", "invalid_date_range", "date_range_too_large"}:
            raise HTTPException(status_code=400, detail=str(exc))
        raise
    return {"availability": availability}


@app.get("/session")
def get_session_state(session=Depends(require_session)):
    return {
        "status": "ok",
        "apartment_id": session["apartment_id"],
        "expires_at": session["expires_at"],
    }


@app.get("/resources", response_model=ResourcesResponse)
def list_resources(session=Depends(require_session), conn=Depends(get_db)):
    rows = conn.execute(
        """
        SELECT
            id,
            name,
            booking_type,
            slot_duration_minutes,
            slot_start_hour,
            slot_end_hour,
            max_future_days,
            min_future_days,
            max_bookings,
            allow_houses,
            deny_apartment_ids,
            price_cents,
            is_billable
        FROM resources
        WHERE is_active = 1
        ORDER BY id ASC
        """
    ).fetchall()
    resources = []
    for row in rows:
        if session["is_admin"] or can_access_resource(
            conn,
            int(row["id"]),
            session["apartment_id"],
            is_admin=bool(session["is_admin"]),
        ):
            resources.append(dict(row))
    return {"resources": resources}


@app.get("/bookings", response_model=BookingsResponse)
def list_bookings(session=Depends(require_session), conn=Depends(get_db)):
    rows = conn.execute(
        """
        SELECT b.id, b.resource_id, b.start_time, b.end_time, b.is_billable,
               r.name AS resource_name, r.booking_type, r.price_cents
        FROM bookings b
        JOIN resources r ON r.id = b.resource_id
        WHERE b.apartment_id = ?
        ORDER BY b.start_time ASC
        """,
        (session["apartment_id"],),
    ).fetchall()
    return {"bookings": [dict(row) for row in rows]}


@app.post("/book", response_model=BookingResponse)
def book(payload: BookRequest, session=Depends(require_session), conn=Depends(get_db)):
    if not session["is_admin"] and payload.apartment_id != session["apartment_id"]:
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        booking_id = create_booking(
            conn,
            payload.apartment_id,
            payload.resource_id,
            payload.start_time,
            payload.end_time,
            bool(payload.is_billable),
            bool(session["is_admin"]),
        )
    except PermissionError:
        raise HTTPException(status_code=403, detail="forbidden_resource")
    except ValueError as exc:
        if str(exc) == "max_bookings":
            raise HTTPException(status_code=409, detail="max_bookings_reached")
        if str(exc) == "outside_booking_window":
            raise HTTPException(status_code=409, detail="outside_booking_window")
        raise HTTPException(status_code=409, detail="overlap")
    return BookingResponse(booking_id=booking_id)


@app.delete("/cancel")
def cancel(payload: CancelRequest, session=Depends(require_session), conn=Depends(get_db)):
    ok = cancel_booking(
        conn, payload.booking_id, session["apartment_id"], bool(session["is_admin"])
    )
    if not ok:
        raise HTTPException(status_code=404, detail="not_found")
    return JSONResponse({"status": "ok"})


@app.get("/admin/calendar")
def calendar(session=Depends(require_session), conn=Depends(get_db)):
    if not session["is_admin"]:
        raise HTTPException(status_code=403, detail="forbidden")
    return {"bookings": admin_calendar(conn)}


@app.get("/health")
def health():
    return {"status": "ok"}
