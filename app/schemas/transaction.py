from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class TransactionBase(BaseModel):
    type: str
    amount: float = Field(gt=0)
    description: str = Field(max_length=200)
    category: str = Field(min_length=1, max_length=50)
    date: str
    account_id: Optional[int] = None

class TransactionCreate(TransactionBase):
    @classmethod
    def validate_type(cls, v):
        if v not in ("income", "expense"):
            raise ValueError("type must be 'income' or 'expense'")
        return v

    @classmethod
    def validate_date(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("date must be YYYY-MM-DD")
        return v

class TransactionUpdate(BaseModel):
    type: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    description: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=50)
    date: Optional[str] = None
    account_id: Optional[int] = None

    @classmethod
    def validate_type(cls, v):
        if v is not None and v not in ("income", "expense"):
            raise ValueError("type must be 'income' or 'expense'")
        return v

    @classmethod
    def validate_date(cls, v):
        if v is not None:
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                raise ValueError("date must be YYYY-MM-DD")
        return v

class TransactionOut(TransactionBase):
    id: int
    created: str