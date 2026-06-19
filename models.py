from pydantic import BaseModel, Field, field_validator
from datetime import datetime


class TransactionIn(BaseModel):
    type: str
    amount: float = Field(gt=0)
    desc: str = Field(max_length=200)
    category: str = Field(min_length=1, max_length=50)
    date: str
    account_id: int | None = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v):
        if v not in ("income", "expense"):
            raise ValueError("type must be 'income' or 'expense'")
        return v

    @field_validator("date")
    @classmethod
    def validate_date(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("date must be YYYY-MM-DD")
        return v


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    balance: float = 0.0
    type: str = 'checking'


class AccountOut(BaseModel):
    id: int
    name: str
    balance: float
    type: str


class TransactionUpdate(BaseModel):
    type: str | None = None
    amount: float | None = Field(default=None, gt=0)
    desc: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=50)
    date: str | None = None
    account_id: int | None = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v):
        if v is not None and v not in ("income", "expense"):
            raise ValueError("type must be 'income' or 'expense'")
        return v

    @field_validator("date")
    @classmethod
    def validate_date(cls, v):
        if v is not None:
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                raise ValueError("date must be YYYY-MM-DD")
        return v


class BudgetIn(BaseModel):
    category: str = Field(min_length=1, max_length=50)
    limit_amt: float = Field(gt=0)


class AIQuery(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    transactions: list = []
    summary: dict = {}
    budgets: list = []
