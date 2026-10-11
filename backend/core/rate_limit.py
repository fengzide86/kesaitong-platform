"""One application limiter for login and business routes, with fail-closed storage."""
from collections.abc import Callable
from typing import Any

from fastapi import Request
from limits.errors import StorageError
from redis.exceptions import RedisError
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.config import settings


class RateLimitStorageUnavailable(Exception):
    """A required distributed limiter cannot make a safe admission decision."""


class ApplicationLimiter(Limiter):
    def _check_request_limit(
        self, request: Request, endpoint_func: Callable[..., Any] | None, in_middleware: bool = True
    ) -> None:
        try:
            super()._check_request_limit(request, endpoint_func, in_middleware)
        except (RedisError, StorageError) as error:
            # The optional, explicitly configured memory fallback happens in
            # SlowAPI itself. Required storage failures must not admit writes.
            raise RateLimitStorageUnavailable() from error


def create_limiter() -> ApplicationLimiter:
    if settings.REDIS_REQUIRED and not settings.REDIS_URL:
        raise RuntimeError("Redis 是必需限流依赖但未配置，拒绝启动")
    return ApplicationLimiter(
        key_func=get_remote_address,
        default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
        storage_uri=settings.REDIS_URL or "memory://",
        in_memory_fallback_enabled=not settings.REDIS_REQUIRED,
        storage_options={"socket_connect_timeout": 1, "socket_timeout": 1} if settings.REDIS_URL else {},
    )


limiter = create_limiter()
