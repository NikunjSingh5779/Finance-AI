from pydantic import BaseModel, Field
from typing import Optional

class AccountBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    balance: float = 0.0
    type: str = 'checking'

class AccountCreate(AccountBase):
    @classmethod
    def validate_type(cls, v):
        allowed_types = ['checking', 'savings', 'credit', 'cash', 'investment']
        if v not in allowed_types:
            raise ValueError(f"Account type must be one of {allowed_types}")
        return v

class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    balance: Optional[float] = None
    type: Optional[str] = None

    @classmethod
    def validate_type(cls, v):
        if v is not None:
            allowed_types = ['checking', 'savings', 'credit', 'cash', 'investment']
            if v not in allowed_types:
                raise ValueError(f"Account type must be one of {allowed_types}")
        return v

class AccountOut(AccountBase):
    id: int