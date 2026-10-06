import math

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BudgetBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    category: str = Field(min_length=1, max_length=50)
    limit_amt: float = Field(gt=0)

    @field_validator("limit_amt")
    @classmethod
    def validate_limit(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("limit_amt must be a finite number")
        return value


class BudgetCreate(BudgetBase):
    pass


class BudgetUpdate(BaseModel):
    limit_amt: float | None = Field(default=None, gt=0)

    @field_validator("limit_amt")
    @classmethod
    def validate_limit(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("limit_amt must be a finite number")
        return value


class BudgetOut(BudgetBase):
    id: int
