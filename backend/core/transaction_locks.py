"""Database transaction guards shared by all workers (never process locks)."""

import asyncio

from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import ConflictException
from models import Setting


async def acquire_transaction_guard(db: AsyncSession, name: str) -> None:
    """Lock a durable unique row, including safe first-use initialization.

    The no-op upsert takes a write lock on SQLite and InnoDB and holds it until
    the caller commits/rolls back. Call before any business mutation. Reads of
    guarded data must still be locking reads to avoid a MySQL REPEATABLE READ
    snapshot established before the lock.
    """
    values = {"key": f"transaction_guard:{name}", "value": "1", "description": "Internal transaction guard"}
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        statement = sqlite_insert(Setting).values(**values)
        statement = statement.on_conflict_do_update(index_elements=[Setting.key], set_={"value": Setting.value})
    elif dialect in {"mysql", "mariadb"}:
        statement = mysql_insert(Setting).values(**values)
        statement = statement.on_duplicate_key_update(value=Setting.value)
    else:
        raise RuntimeError(f"Unsupported transaction-guard dialect: {dialect}")
    if db.new or db.dirty or db.deleted:
        raise RuntimeError("Acquire transaction guard before business mutations")
    for attempt in range(3):
        try:
            await db.execute(statement)
            return
        except OperationalError as error:
            # InnoDB may choose this first-write waiter as the deadlock victim
            # during first-use initialization (unique-key/gap locks). It has
            # rolled back the transaction; reset the ORM too, then acquire and
            # reread. No business write or audit has happened at this boundary.
            if dialect not in {"mysql", "mariadb"} or not error.orig.args or error.orig.args[0] != 1213:
                raise
            await db.rollback()
            if attempt == 2:
                raise ConflictException("并发更新繁忙，请刷新后重试") from error
            await asyncio.sleep(0.01 * (attempt + 1))
