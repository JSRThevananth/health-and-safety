from datetime import date
from io import StringIO
import csv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import auth, models, schemas
from .database import Base, engine, get_db

app = FastAPI(title="Sanitation Team Performance Measuring Program")
Base.metadata.create_all(bind=engine)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/login", response_model=schemas.Token)
def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == req.username).first()
    if not user or not auth.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = auth.create_access_token({"sub": user.username, "user_id": user.id, "role": user.role})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()


@app.get("/areas", response_model=list[schemas.AreaOut])
def list_areas(db: Session = Depends(get_db)):
    return db.query(models.Area).all()


@app.get("/shifts", response_model=list[schemas.ShiftOut])
def list_shifts(db: Session = Depends(get_db)):
    return db.query(models.Shift).all()


@app.post("/tasks", response_model=schemas.TaskOut)
def create_task(task: schemas.TaskCreate, db: Session = Depends(get_db)):
    item = models.SanitationTask(**task.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/tasks", response_model=list[schemas.TaskOut])
def list_tasks(
    start_date: date | None = None,
    end_date: date | None = None,
    shift_id: int | None = None,
    area_id: int | None = None,
    team: str | None = None,
    supervisor: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.SanitationTask).join(models.User, models.SanitationTask.staff_id == models.User.id)
    if start_date:
        q = q.filter(models.SanitationTask.task_date >= start_date)
    if end_date:
        q = q.filter(models.SanitationTask.task_date <= end_date)
    if shift_id:
        q = q.filter(models.SanitationTask.shift_id == shift_id)
    if area_id:
        q = q.filter(models.SanitationTask.area_id == area_id)
    if team:
        q = q.filter(models.User.team == team)
    if supervisor:
        q = q.filter(models.User.supervisor == supervisor)
    return q.order_by(models.SanitationTask.task_date.desc()).all()


@app.post("/verifications", response_model=schemas.VerificationOut)
def create_verification(check: schemas.VerificationCreate, db: Session = Depends(get_db)):
    item = models.VerificationCheck(**check.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/verifications", response_model=list[schemas.VerificationOut])
def list_verifications(db: Session = Depends(get_db)):
    return db.query(models.VerificationCheck).order_by(models.VerificationCheck.checked_at.desc()).all()


@app.post("/deviations", response_model=schemas.DeviationOut)
def create_deviation(dev: schemas.DeviationCreate, db: Session = Depends(get_db)):
    item = models.Deviation(**dev.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/deviations", response_model=list[schemas.DeviationOut])
def list_deviations(db: Session = Depends(get_db)):
    return db.query(models.Deviation).order_by(models.Deviation.created_at.desc()).all()


@app.post("/corrective-actions", response_model=schemas.CorrectiveActionOut)
def create_ca(ca: schemas.CorrectiveActionCreate, db: Session = Depends(get_db)):
    item = models.CorrectiveAction(**ca.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.get("/corrective-actions", response_model=list[schemas.CorrectiveActionOut])
def list_ca(db: Session = Depends(get_db)):
    return db.query(models.CorrectiveAction).all()


def _filtered_tasks(db: Session, start_date, end_date, shift_id, area_id, team, supervisor):
    q = db.query(models.SanitationTask).join(models.User, models.SanitationTask.staff_id == models.User.id)
    if start_date:
        q = q.filter(models.SanitationTask.task_date >= start_date)
    if end_date:
        q = q.filter(models.SanitationTask.task_date <= end_date)
    if shift_id:
        q = q.filter(models.SanitationTask.shift_id == shift_id)
    if area_id:
        q = q.filter(models.SanitationTask.area_id == area_id)
    if team:
        q = q.filter(models.User.team == team)
    if supervisor:
        q = q.filter(models.User.supervisor == supervisor)
    return q.all()


@app.get("/kpis")
def kpis(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    shift_id: int | None = Query(default=None),
    area_id: int | None = Query(default=None),
    team: str | None = Query(default=None),
    supervisor: str | None = Query(default=None),
    include_allergen: bool = True,
    db: Session = Depends(get_db),
):
    tasks = _filtered_tasks(db, start_date, end_date, shift_id, area_id, team, supervisor)
    task_ids = [t.id for t in tasks]
    if not tasks:
        return {}

    preop_checks = db.query(models.VerificationCheck).filter(
        models.VerificationCheck.task_id.in_(task_ids), models.VerificationCheck.check_type == "visual"
    ).all()
    atp_checks = db.query(models.VerificationCheck).filter(
        models.VerificationCheck.task_id.in_(task_ids), models.VerificationCheck.check_type == "atp"
    ).all()
    deviations = db.query(models.Deviation).filter(models.Deviation.task_id.in_(task_ids)).all()

    on_time = sum(1 for t in tasks if t.actual_end <= t.planned_end)
    reclean = sum(1 for t in tasks if t.status.lower() == "reclean")
    chemical_compliant = sum(1 for t in tasks if t.chemical_compliant)

    ca_query = db.query(models.CorrectiveAction).join(models.Deviation).filter(models.Deviation.task_id.in_(task_ids))
    cas = ca_query.all()
    closure_days = [
        (ca.closed_date - ca.due_date).days
        for ca in cas
        if ca.closed_date is not None
    ]

    allergen_tasks = [t for t in tasks if t.allergen_changeover]
    allergen_pass = sum(1 for t in allergen_tasks if t.allergen_pass)

    preop_pass_rate = (sum(1 for c in preop_checks if c.passed) / len(preop_checks) * 100) if preop_checks else 0
    atp_pass_rate = (sum(1 for c in atp_checks if c.passed) / len(atp_checks) * 100) if atp_checks else 0
    reclean_rate = reclean / len(tasks) * 100
    on_time_rate = on_time / len(tasks) * 100
    repeat_deviation_rate = (sum(1 for d in deviations if d.is_repeat) / len(deviations) * 100) if deviations else 0
    chemical_compliance = chemical_compliant / len(tasks) * 100
    avg_capa_closure = sum(closure_days) / len(closure_days) if closure_days else 0
    allergen_pass_rate = (allergen_pass / len(allergen_tasks) * 100) if allergen_tasks else 0

    audit_readiness = (
        0.2 * preop_pass_rate
        + 0.2 * atp_pass_rate
        + 0.15 * (100 - reclean_rate)
        + 0.15 * on_time_rate
        + 0.15 * chemical_compliance
        + 0.15 * (allergen_pass_rate if include_allergen else 100)
    )

    return {
        "pre_op_pass_rate": round(preop_pass_rate, 2),
        "atp_pass_rate": round(atp_pass_rate, 2),
        "reclean_rate": round(reclean_rate, 2),
        "on_time_completion": round(on_time_rate, 2),
        "deviation_count": len(deviations),
        "avg_capa_closure_time_days": round(avg_capa_closure, 2),
        "repeat_deviation_rate": round(repeat_deviation_rate, 2),
        "chemical_compliance": round(chemical_compliance, 2),
        "allergen_changeover_pass_rate": round(allergen_pass_rate, 2),
        "audit_readiness_score": round(audit_readiness, 2),
    }


@app.get("/exports/{table_name}")
def export_table(table_name: str, db: Session = Depends(get_db)):
    model_map = {
        "tasks": models.SanitationTask,
        "verifications": models.VerificationCheck,
        "deviations": models.Deviation,
        "corrective_actions": models.CorrectiveAction,
    }
    model = model_map.get(table_name)
    if not model:
        raise HTTPException(404, "table not found")

    rows = db.query(model).all()
    output = StringIO()
    if rows:
        writer = csv.DictWriter(output, fieldnames=rows[0].__table__.columns.keys())
        writer.writeheader()
        for row in rows:
            writer.writerow({col: getattr(row, col) for col in rows[0].__table__.columns.keys()})
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={table_name}.csv"})


@app.get("/exports/kpi-summary")
def export_kpi_summary(db: Session = Depends(get_db)):
    data = kpis(db=db)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["kpi", "value"])
    for key, value in data.items():
        writer.writerow([key, value])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=kpi_summary.csv"})
