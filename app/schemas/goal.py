import math
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GoalCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    target_amount: float = Field(gt=0)
    current_amount: float = Field(default=0, ge=0)
    target_date: str | None = None
    category: str = Field(default="Savings", min_length=1, max_length=50)

    @field_validator("target_amount", "current_amount")
    @classmethod
    def validate_amount(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("amount must be finite")
        return value

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("target_date must be YYYY-MM-DD") from exc
        return value


class GoalUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    target_amount: float | None = Field(default=None, gt=0)
    current_amount: float | None = Field(default=None, ge=0)
    target_date: str | None = None
    category: str | None = Field(default=None, min_length=1, max_length=50)

    @field_validator("target_amount", "current_amount")
    @classmethod
    def validate_amount(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("amount must be finite")
        return value

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("target_date must be YYYY-MM-DD") from exc
        return value


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    target_amount: float
    current_amount: float
    target_date: str | None
    category: str
    progress_percent: float
    remaining_amount: float
    monthly_required: float | None
    months_remaining: int | None
    status: str
    created: str
