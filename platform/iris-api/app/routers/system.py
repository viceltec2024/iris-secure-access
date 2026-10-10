from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import current_user
from ..config import get_settings
from ..db import get_db
from ..models import User
from ..schemas import AuditOut, HealthOut
from .. import services

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)):
    settings = get_settings()
    db.execute(text("SELECT 1"))
    dialect = db.get_bind().dialect.name
    return HealthOut(
        status="ok",
        module="iris-api",
        database=dialect,
        allowed_models=settings.model_allowlist,
    )


@router.get("/audit", response_model=list[AuditOut])
def audit(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = services.list_audit(db, user)
    return [
        AuditOut(
            id=row.id,
            actor_email=row.actor_email,
            action=row.action,
            resource=row.resource,
            outcome=row.outcome,
            metadata_json=row.metadata_json,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/tasks", response_model=list)
def tasks(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return services.list_tasks(db, user)
