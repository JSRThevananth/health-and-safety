from datetime import datetime, date
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    team: Mapped[str] = mapped_column(String(60), nullable=False)
    supervisor: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)


class Area(Base):
    __tablename__ = "areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    zone: Mapped[str] = mapped_column(String(100), nullable=False)
    atp_threshold: Mapped[float] = mapped_column(Float, default=30)
    tpc_threshold: Mapped[float] = mapped_column(Float, default=100)
    chemical_target_pct: Mapped[float] = mapped_column(Float, default=95)
    allergen_enabled: Mapped[bool] = mapped_column(Boolean, default=False)


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    start_hour: Mapped[str] = mapped_column(String(5), nullable=False)
    end_hour: Mapped[str] = mapped_column(String(5), nullable=False)


class SanitationTask(Base):
    __tablename__ = "sanitation_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id"), nullable=False)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id"), nullable=False)
    staff_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    planned_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    planned_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    actual_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    actual_end: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    chemical_compliant: Mapped[bool] = mapped_column(Boolean, default=True)
    allergen_changeover: Mapped[bool] = mapped_column(Boolean, default=False)
    allergen_pass: Mapped[bool] = mapped_column(Boolean, default=True)

    area = relationship("Area")
    shift = relationship("Shift")
    staff = relationship("User")
    checks = relationship("VerificationCheck", back_populates="task")
    deviations = relationship("Deviation", back_populates="task")


class VerificationCheck(Base):
    __tablename__ = "verification_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("sanitation_tasks.id"), nullable=False)
    check_type: Mapped[str] = mapped_column(String(20), nullable=False)  # visual/atp/tpc
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    checked_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    task = relationship("SanitationTask", back_populates="checks")


class Deviation(Base):
    __tablename__ = "deviations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("sanitation_tasks.id"), nullable=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    is_repeat: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(20), default="Open")

    task = relationship("SanitationTask", back_populates="deviations")
    area = relationship("Area")
    corrective_actions = relationship("CorrectiveAction", back_populates="deviation")


class CorrectiveAction(Base):
    __tablename__ = "corrective_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deviation_id: Mapped[int] = mapped_column(ForeignKey("deviations.id"), nullable=False)
    action_description: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    closed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Open")
    performed_by_initials: Mapped[str] = mapped_column(String(12), default="")

    deviation = relationship("Deviation", back_populates="corrective_actions")
