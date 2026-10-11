"""Serialize authorization changes, unbinding and grant consumption."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import AuthCode


async def lock_auth_code(db: AsyncSession, code_id: int) -> AuthCode | None:
    # Also takes a write lock in SQLite, whose SELECT FOR UPDATE is a no-op.
    await db.execute(update(AuthCode).where(AuthCode.id == code_id).values(status=AuthCode.status))
    return (await db.execute(
        select(AuthCode).where(AuthCode.id == code_id)
        .options(selectinload(AuthCode.devices)).with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
