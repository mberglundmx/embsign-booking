from typing import Optional

from pydantic import BaseModel


class RFIDLoginRequest(BaseModel):
    uid: str


class MobileLoginRequest(BaseModel):
    apartment_id: str
    password: str


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


class BookingResponse(BaseModel):
    booking_id: int


class ResourceItem(BaseModel):
    id: int
    name: str
    booking_type: str
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


class BookingsResponse(BaseModel):
    bookings: list[BookingItem]

