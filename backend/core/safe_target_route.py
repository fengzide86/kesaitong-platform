"""A submitted entry may contain credentials: never echo invalid input."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute


class SafeTargetRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()
        if "/target-profiles" not in self.path:
            return original

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError as exc:
                return JSONResponse(status_code=422, content={
                    "success": False,
                    "message": "入口登记字段无效，请检查格式；原始内容未回显",
                    "detail": [{"loc": error["loc"], "type": error["type"]} for error in exc.errors()],
                })
        return handler
