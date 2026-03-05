from typing import Optional

from pydantic import BaseModel


class RFIDLoginRequest(BaseModel):
    uid: str


class MobileLoginRequest(BaseModel):
    apartment_id: str
    password: str


class MobilePasswordUpdateRequest(BaseModel):
    new_password: str


class BookRequest(BaseModel):
    apartment_id: str
    resource_id: int
    start_time: str
    end_time: str
    is_billable: Optional[bool] = False


class CancelRequest(BaseModel):
    booking_id: int


class LoginResponse(BaseModel):
    booking_url: str
    apartment_id: str
    is_admin: bool = False


class BookingResponse(BaseModel):
    booking_id: int


class AdminBlockRequest(BaseModel):
    resource_id: int
    start_time: str
    end_time: str
    reason: Optional[str] = ""


class AdminBlockResponse(BaseModel):
    block_id: int


class DeleteBlockRequest(BaseModel):
    block_id: int


class ResourceItem(BaseModel):
    id: int
    name: str
    booking_type: str
    category: str = ""
    slot_duration_minutes: int
    slot_start_hour: int
    slot_end_hour: int
    max_future_days: int
    min_future_days: int
    max_bookings: int
    price_weekday_cents: int = 0
    price_weekend_cents: int = 0
    price_cents: int
    is_billable: bool


class ResourcesResponse(BaseModel):
    resources: list[ResourceItem]


class BookingItem(BaseModel):
    id: int
    resource_id: int
    resource_name: str
    start_time: str
    end_time: str
    is_billable: bool
    booking_type: str
    price_cents: int
    apartment_id: Optional[str] = None
    entry_type: str = "booking"
    blocked_reason: Optional[str] = None


class BookingsResponse(BaseModel):
    bookings: list[BookingItem]
