from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import authenticate, create_access_token, ensure_bootstrap_admin
from ..db import get_db
from ..schemas import BootstrapOut, LoginIn, TokenOut
from ..services import write_audit

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/bootstrap", response_model=BootstrapOut)
def bootstrap(db: Session = Depends(get_db)):
    user, created = ensure_bootstrap_admin(db)
    if created:
        write_audit(db, user.email, "ADMIN_BOOTSTRAPPED", "users", "SUCCESS", {})
        db.commit()
    return BootstrapOut(
        created=created,
        email=user.email,
        message="Admin listo" if not created else "Admin creado",
    )


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    ensure_bootstrap_admin(db)
    user = authenticate(db, body.email, body.password)
    if not user:
        write_audit(db, body.email.lower(), "LOGIN", "auth", "DENIED", {})
        db.commit()
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="Invalid credentials")
    write_audit(db, user.email, "LOGIN", "auth", "SUCCESS", {})
    db.commit()
    return TokenOut(access_token=create_access_token(user.email, user.role), email=user.email, role=user.role)
