import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AccountType = Literal["checking", "savings", "credit", "cash", "investment"]


class AccountBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    balance: float = 0.0
    type: AccountType = "checking"

    @field_validator("balance")
    @classmethod
    def validate_balance(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("balance must be a finite number")
        return value


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    balance: float | None = None
    type: AccountType | None = None

    @field_validator("balance")
    @classmethod
    def validate_balance(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("balance must be a finite number")
        return value


class AccountOut(AccountBase):
    id: int
    current_balance: float | None = None
