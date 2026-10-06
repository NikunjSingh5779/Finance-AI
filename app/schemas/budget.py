from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class BudgetBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    category: str = Field(min_length=1, max_length=50)
    limit_amt: float = Field(gt=0)


class BudgetCreate(BudgetBase):
    pass


class BudgetUpdate(BaseModel):
    limit_amt: Optional[float] = Field(default=None, gt=0)


class BudgetOut(BudgetBase):
    id: int
