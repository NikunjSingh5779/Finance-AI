import math
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RecurringFrequency = Literal["weekly", "monthly", "yearly"]
TransactionKind = Literal["income", "expense"]


def _validate_iso_date(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must be YYYY-MM-DD") from exc
    return value


class RecurringItemCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0)
    type: TransactionKind
    category: str = Field(min_length=1, max_length=50)
    frequency: RecurringFrequency
    next_due_date: str
    account_id: int | None = None

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("amount must be finite")
        return value

    @field_validator("next_due_date")
    @classmethod
    def validate_due_date(cls, value: str) -> str:
        return _validate_iso_date(value) or value


class RecurringItemUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    amount: float | None = Field(default=None, gt=0)
    type: TransactionKind | None = None
    category: str | None = Field(default=None, min_length=1, max_length=50)
    frequency: RecurringFrequency | None = None
    next_due_date: str | None = None
    account_id: int | None = None
    is_active: bool | None = None

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("amount must be finite")
        return value

    @field_validator("next_due_date")
    @classmethod
    def validate_due_date(cls, value: str | None) -> str | None:
        return _validate_iso_date(value)


class RecurringPaymentRequest(BaseModel):
    due_date: str

    @field_validator("due_date")
    @classmethod
    def validate_due_date(cls, value: str) -> str:
        return _validate_iso_date(value) or value


class RecurringItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    amount: float
    type: TransactionKind
    category: str
    frequency: RecurringFrequency
    next_due_date: str
    schedule_day: int
    schedule_month: int | None
    account_id: int | None
    is_active: bool
    is_archived: bool = False
    last_recorded_due_date: str | None
    created: str | None

    @field_validator("created", mode="before")
    @classmethod
    def normalize_created(cls, value: str | datetime | None) -> str | None:
        if isinstance(value, datetime):
            return value.isoformat()
        return value
