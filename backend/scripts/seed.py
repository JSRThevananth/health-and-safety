from datetime import datetime, date, timedelta
from app.database import Base, SessionLocal, engine
from app.models import Area, CorrectiveAction, Deviation, SanitationTask, Shift, User, VerificationCheck
from app.auth import get_password_hash


def run():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.query(User).count() > 0:
        print("Seed data already exists")
        return

    users = [
        User(username="qa1", full_name="QA Manager", role="QA", team="QA Team", supervisor="Plant QA Head", password_hash=get_password_hash("qa123")),
        User(username="lead1", full_name="Sanitation Lead A", role="Sanitation Lead", team="Night A", supervisor="Ops Sup A", password_hash=get_password_hash("lead123")),
        User(username="staff1", full_name="Sanitation Staff 1", role="Sanitation Staff", team="Night A", supervisor="Ops Sup A", password_hash=get_password_hash("staff123")),
        User(username="staff2", full_name="Sanitation Staff 2", role="Sanitation Staff", team="Day B", supervisor="Ops Sup B", password_hash=get_password_hash("staff123")),
    ]
    db.add_all(users)

    areas = [
        Area(name="Final Assembly", zone="Production", atp_threshold=30, tpc_threshold=90, chemical_target_pct=95, allergen_enabled=True),
        Area(name="Make and Pack", zone="Production", atp_threshold=30, tpc_threshold=90, chemical_target_pct=95, allergen_enabled=True),
        Area(name="Wash and Pack", zone="Production", atp_threshold=30, tpc_threshold=90, chemical_target_pct=95, allergen_enabled=True),
        Area(name="Pick and Pack", zone="Production", atp_threshold=30, tpc_threshold=90, chemical_target_pct=95, allergen_enabled=True),
        Area(name="Inbound", zone="Logistics", atp_threshold=35, tpc_threshold=100, chemical_target_pct=95, allergen_enabled=False),
        Area(name="Commissary International", zone="Commissary", atp_threshold=30, tpc_threshold=90, chemical_target_pct=95, allergen_enabled=True),
        Area(name="Commissary Domestic", zone="Commissary", atp_threshold=30, tpc_threshold=90, chemical_target_pct=95, allergen_enabled=True),
        Area(name="Warehouse and Receiving", zone="Logistics", atp_threshold=35, tpc_threshold=100, chemical_target_pct=95, allergen_enabled=False),
        Area(name="Hot Kitchen", zone="Kitchen", atp_threshold=25, tpc_threshold=80, chemical_target_pct=96, allergen_enabled=True),
        Area(name="Central Recipe Assembly", zone="Kitchen", atp_threshold=25, tpc_threshold=80, chemical_target_pct=96, allergen_enabled=True),
    ]
    db.add_all(areas)

    shifts = [
        Shift(name="Shift A", start_hour="06:00", end_hour="14:00"),
        Shift(name="Shift B", start_hour="14:00", end_hour="22:00"),
        Shift(name="Shift C", start_hour="22:00", end_hour="06:00"),
    ]
    db.add_all(shifts)
    db.commit()

    staff1 = db.query(User).filter_by(username="staff1").first()
    staff2 = db.query(User).filter_by(username="staff2").first()
    qa = db.query(User).filter_by(username="qa1").first()
    area1 = db.query(Area).filter_by(name="Final Assembly").first()
    area2 = db.query(Area).filter_by(name="Make and Pack").first()
    shift_a = db.query(Shift).filter_by(name="Shift A").first()
    shift_b = db.query(Shift).filter_by(name="Shift B").first()

    base_date = date.today() - timedelta(days=6)
    tasks = []
    for i in range(7):
        d = base_date + timedelta(days=i)
        t1 = SanitationTask(
            task_date=d,
            area_id=area1.id,
            shift_id=shift_a.id,
            staff_id=staff1.id,
            planned_start=datetime.combine(d, datetime.strptime("06:00", "%H:%M").time()),
            planned_end=datetime.combine(d, datetime.strptime("08:00", "%H:%M").time()),
            actual_start=datetime.combine(d, datetime.strptime("06:05", "%H:%M").time()),
            actual_end=datetime.combine(d, datetime.strptime("08:10" if i % 3 == 0 else "07:55", "%H:%M").time()),
            status="Reclean" if i % 4 == 0 else "Completed",
            notes="Routine clean",
            chemical_compliant=i % 5 != 0,
            allergen_changeover=True,
            allergen_pass=i % 3 != 0,
        )
        t2 = SanitationTask(
            task_date=d,
            area_id=area2.id,
            shift_id=shift_b.id,
            staff_id=staff2.id,
            planned_start=datetime.combine(d, datetime.strptime("14:00", "%H:%M").time()),
            planned_end=datetime.combine(d, datetime.strptime("16:00", "%H:%M").time()),
            actual_start=datetime.combine(d, datetime.strptime("13:55", "%H:%M").time()),
            actual_end=datetime.combine(d, datetime.strptime("15:50", "%H:%M").time()),
            status="Completed",
            notes="Deep clean",
            chemical_compliant=True,
            allergen_changeover=False,
            allergen_pass=True,
        )
        tasks.extend([t1, t2])
    db.add_all(tasks)
    db.commit()

    all_tasks = db.query(SanitationTask).all()
    for i, task in enumerate(all_tasks):
        db.add(VerificationCheck(task_id=task.id, check_type="visual", value=None, passed=i % 6 != 0, checked_by=qa.id))
        db.add(VerificationCheck(task_id=task.id, check_type="atp", value=20 + (i % 5) * 10, passed=i % 5 != 0, checked_by=qa.id))
        db.add(VerificationCheck(task_id=task.id, check_type="tpc", value=40 + (i % 4) * 30, passed=i % 4 != 0, checked_by=qa.id))
    db.commit()

    first_task = all_tasks[0]
    dev = Deviation(task_id=first_task.id, area_id=first_task.area_id, category="ATP Failure", description="High ATP reading", severity="Major", is_repeat=True)
    db.add(dev)
    db.commit()
    db.refresh(dev)
    db.add(CorrectiveAction(deviation_id=dev.id, action_description="Reclean and retrain staff", owner_id=staff1.id, due_date=date.today() - timedelta(days=2), closed_date=date.today(), status="Closed", performed_by_initials="SS"))
    db.commit()
    print("Seed complete")


if __name__ == "__main__":
    run()
