from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AccountType = Literal["checking", "savings", "credit", "cash", "investment"]


class AccountBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    balance: float = Field(default=0.0, ge=0)
    type: AccountType = "checking"


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    balance: float | None = Field(default=None, ge=0)
    type: AccountType | None = None


class AccountOut(AccountBase):
    id: int
    current_balance: float | None = None
