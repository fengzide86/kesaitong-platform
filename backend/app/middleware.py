from __future__ import annotations

import asyncio
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from core.logging import _request_id_var, _user_id_var, get_logger

logger = get_logger(__name__)


class RequestTrackingMiddleware:
    """Track a response without converting an interrupted stream to a final body.

    BaseHTTPMiddleware may close its body iterator before re-raising a producer
    failure, which lets a client accept truncated CSV as a complete response.
    Direct ASGI forwarding preserves backpressure, failure and disconnects.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = uuid.uuid4().hex[:8]
        # ContextVar tokens also restore a caller's context when nested. Calling
        # set_request_id("") instead would generate another ID, not clear it.
        request_token = _request_id_var.set(request_id)
        user_token = _user_id_var.set(None)
        started_at = time.perf_counter()
        client = scope.get("client")
        client_ip = client[0] if client else "unknown"
        method, path = scope["method"], scope["path"]
        status = None
        completed = False

        async def send_tracked(message: Message) -> None:
            nonlocal status, completed
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(raw=message["headers"])
                headers["X-Request-ID"] = request_id
                headers["X-Process-Time"] = f"{time.perf_counter() - started_at:.3f}"
            await send(message)
            if message["type"] == "http.response.pathsend" or (
                message["type"] == "http.response.body" and not message.get("more_body", False)
            ):
                completed = True

        try:
            await self.app(scope, receive, send_tracked)
            elapsed = time.perf_counter() - started_at
            log_request = logger.warning if elapsed >= 1.0 or not completed else logger.info
            log_request(
                "[%s] %s %s - 状态: %s - 耗时: %.3fs - IP: %s - 完整响应: %s",
                request_id, method, path, status, elapsed, client_ip, completed,
            )
        except asyncio.CancelledError:
            logger.warning("[%s] %s %s 请求取消", request_id, method, path)
            raise
        except Exception:
            logger.exception("[%s] %s %s 请求失败", request_id, method, path)
            raise
        finally:
            _request_id_var.reset(request_token)
            _user_id_var.reset(user_token)
