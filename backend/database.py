"""Database engine, sessions, schema gate and health checks."""
from __future__ import annotations

import hashlib
import re
import time
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import HTTPException
from sqlalchemy import event, text
from sqlalchemy.engine import Connection, ExecutionContext
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings
from core.logging import get_logger
from models.base import Base

logger = get_logger(__name__)

DATABASE_URL = settings.get_database_url()
SCHEMA_REVISION = "20261015_framework_commerce"

logger.info("数据库类型: %s", settings.DB_TYPE)
logger.info("数据库连接: %s", DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL)

engine_kwargs: dict[str, Any] = {"echo": False}
if settings.DB_TYPE == "mysql":
    engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 5,
        "pool_recycle": 900,
        "pool_pre_ping": True,
        "pool_timeout": 5,
        "connect_args": {
            "connect_timeout": 10,
            "charset": "utf8mb4",
            "init_command": "SET time_zone = '+00:00'",
        },
    })
elif settings.DB_TYPE == "sqlite":
    engine_kwargs.update({"connect_args": {"timeout": 30}})

engine = create_async_engine(DATABASE_URL, **engine_kwargs)
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

SLOW_QUERY_THRESHOLD = 1.0


def sql_fingerprint(statement: str) -> tuple[str, str]:
    """Return a stable operation/fingerprint without logging SQL values."""
    normalized = re.sub(r"\s+", " ", statement).strip()
    operation = normalized.partition(" ")[0].upper() if normalized else "UNKNOWN"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return operation, digest


@event.listens_for(engine.sync_engine, "before_cursor_execute")
def _record_query_start(
    _connection: Connection,
    _cursor: Any,
    _statement: str,
    _parameters: Any,
    context: ExecutionContext,
    _executemany: bool,
) -> None:
    context._kst_query_started_at = time.perf_counter()  # type: ignore[attr-defined]


@event.listens_for(engine.sync_engine, "after_cursor_execute")
def _record_query_finish(
    _connection: Connection,
    _cursor: Any,
    statement: str,
    _parameters: Any,
    context: ExecutionContext,
    executemany: bool,
) -> None:
    started_at = getattr(context, "_kst_query_started_at", None)
    if started_at is None:
        return
    elapsed = time.perf_counter() - float(started_at)
    if elapsed < SLOW_QUERY_THRESHOLD:
        return
    operation, fingerprint = sql_fingerprint(statement)
    logger.with_data(
        "慢 SQL",
        {
            "sql_operation": operation,
            "sql_fingerprint": fingerprint,
            "sql_duration_ms": round(elapsed * 1000, 2),
            "executemany": executemany,
        },
    )


async def get_db() -> AsyncGenerator[AsyncSession]:
    """Yield one transactional request session."""
    async with async_session_maker() as session:
        try:
            yield session
        except HTTPException:
            await session.rollback()
            raise
        except Exception as error:
            await session.rollback()
            logger.error("数据库会话异常: %s", error, exc_info=True)
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Create tables only for local development/tests; gate deployed schemas.

    Internal and production services must be migrated by Alembic before
    systemd starts the new process. The application never runs ad-hoc ALTER
    statements and never silently starts against a stale schema.
    """
    if settings.APP_ENV in {"development", "test"}:
        import models  # noqa: F401

        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        logger.info("开发/测试数据库表已就绪")
        return

    try:
        async with async_session_maker() as session:
            revision = (
                await session.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
            ).scalar_one_or_none()
    except Exception as error:
        raise RuntimeError("数据库尚未由 Alembic 管理，拒绝启动") from error
    if revision != SCHEMA_REVISION:
        raise RuntimeError(
            f"数据库版本不匹配: current={revision or 'none'}, required={SCHEMA_REVISION}"
        )
    logger.info("数据库迁移版本已校验: %s", revision)


async def check_db_health() -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "ok",
        "type": settings.DB_TYPE,
        "latency_ms": None,
    }
    try:
        started = time.time()
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
        result["latency_ms"] = round((time.time() - started) * 1000, 2)
        if result["latency_ms"] > 1000:
            result["status"] = "slow"
    except Exception as error:
        result["status"] = "error"
        result["error"] = str(error)
        logger.error("数据库健康检查失败: %s", error)
    return result


async def get_db_stats() -> dict[str, Any]:
    stats: dict[str, Any] = {"type": settings.DB_TYPE, "pool": {}}
    if settings.DB_TYPE == "mysql":
        pool: Any = engine.pool
        stats["pool"] = {
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    return stats
