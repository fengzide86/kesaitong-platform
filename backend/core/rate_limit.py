"""One application limiter for login and business routes, with fail-closed storage."""
from collections.abc import Callable
from typing import Any

from fastapi import Request
from limits.errors import StorageError
from redis.exceptions import RedisError
from slowapi import Limiter
from slowapi.middleware import _find_route_handler, _should_exempt, async_check_limits
from slowapi.util import get_remote_address
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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


class ApplicationRateLimitMiddleware:
    """Apply SlowAPI policy without replaying response headers for every chunk.

    SlowAPI 0.1.9's ASGI responder emits its saved response.start on *each*
    response.body. Real HTTP streaming then breaks after the first CSV chunk.
    Reuse the pinned package's route/policy checks, but transform only the
    original start event and pass all body/pathsend events through unchanged.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        application = scope["app"]
        application_limiter = application.state.limiter
        handler = _find_route_handler(application.routes, scope)
        if not application_limiter.enabled or _should_exempt(application_limiter, handler):
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive=receive, send=send)
        error_response, inject_headers = await async_check_limits(application_limiter, request, handler, application)
        if error_response is not None:
            await error_response(scope, receive, send)
            return

        started = False

        async def send_response(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                if started:
                    raise RuntimeError("An HTTP response cannot start more than once")
                started = True
                if inject_headers:
                    application_limiter._inject_asgi_headers(
                        MutableHeaders(raw=message["headers"]), request.state.view_rate_limit,
                    )
            await send(message)

        await self.app(scope, receive, send_response)


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
