from datetime import date, datetime
from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    team: str
    supervisor: str

    class Config:
        from_attributes = True


class AreaOut(BaseModel):
    id: int
    name: str
    zone: str
    atp_threshold: float
    tpc_threshold: float
    chemical_target_pct: float
    allergen_enabled: bool

    class Config:
        from_attributes = True


class ShiftOut(BaseModel):
    id: int
    name: str
    start_hour: str
    end_hour: str

    class Config:
        from_attributes = True


class TaskCreate(BaseModel):
    task_date: date
    area_id: int
    shift_id: int
    staff_id: int
    planned_start: datetime
    planned_end: datetime
    actual_start: datetime
    actual_end: datetime
    status: str
    notes: str = ""
    chemical_compliant: bool = True
    allergen_changeover: bool = False
    allergen_pass: bool = True


class TaskOut(TaskCreate):
    id: int

    class Config:
        from_attributes = True


class VerificationCreate(BaseModel):
    task_id: int
    check_type: str
    value: float | None = None
    passed: bool
    checked_by: int


class VerificationOut(VerificationCreate):
    id: int
    checked_at: datetime

    class Config:
        from_attributes = True


class DeviationCreate(BaseModel):
    task_id: int | None = None
    area_id: int
    category: str
    description: str
    severity: str
    is_repeat: bool = False
    status: str = "Open"


class DeviationOut(DeviationCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class CorrectiveActionCreate(BaseModel):
    deviation_id: int
    action_description: str
    owner_id: int
    due_date: date
    closed_date: date | None = None
    status: str = "Open"
    performed_by_initials: str = ""


class CorrectiveActionOut(CorrectiveActionCreate):
    id: int

    class Config:
        from_attributes = True
