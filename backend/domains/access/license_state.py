"""One effective authorization state for verification, filters and counters.

The stored status remains untouched for audit/history. Existing ``expires_at``
values use server-local wall time; this does not migrate historical dates or
reinterpret issued terms. Explicit suspension/deletion keeps precedence.
"""

from datetime import datetime
from typing import cast

from sqlalchemy import and_, case, or_
from sqlalchemy.sql.elements import ColumnElement

from models import AuthCode


def _local_wall_time(value: datetime) -> datetime:
    return value.astimezone().replace(tzinfo=None) if value.tzinfo else value


def effective_license_status(code: AuthCode, *, now: datetime | None = None) -> str:
    status = cast(str, code.status)
    if status in {"frozen", "deleted"}:
        return status
    if status == "expired" or (
        code.expires_at is not None
        and _local_wall_time(code.expires_at) <= _local_wall_time(now or datetime.now())
    ):
        return "expired"
    return status


def effective_license_status_sql(*, now: datetime | None = None) -> ColumnElement[str]:
    cutoff = _local_wall_time(now or datetime.now())
    return case(
        (AuthCode.status.in_(("frozen", "deleted")), AuthCode.status),
        (
            or_(
                AuthCode.status == "expired",
                and_(AuthCode.expires_at.is_not(None), AuthCode.expires_at <= cutoff),
            ),
            "expired",
        ),
        else_=AuthCode.status,
    )
