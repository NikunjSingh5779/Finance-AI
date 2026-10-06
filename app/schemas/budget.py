from pydantic import BaseModel, Field

class BudgetBase(BaseModel):
    category: str
    limit_amt: float

class BudgetCreate(BudgetBase):
    pass

class BudgetUpdate(BaseModel):
    limit_amt: Optional[float] = None

class BudgetOut(BudgetBase):
    id: int