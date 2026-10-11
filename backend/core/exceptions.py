"""
自定义异常和全局异常处理
提供统一的错误处理机制
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


# ===== 自定义异常类 =====


class BusinessException(Exception):
    """业务异常基类"""

    def __init__(self, message: str, code: int = 400) -> None:
        self.message = message
        self.code = code


class NotFoundException(BusinessException):
    """资源不存在异常"""

    def __init__(self, message: str = "资源不存在") -> None:
        super().__init__(message, 404)


class UnauthorizedException(BusinessException):
    """未授权访问异常"""

    def __init__(self, message: str = "未授权访问") -> None:
        super().__init__(message, 401)


class ForbiddenException(BusinessException):
    """禁止访问异常"""

    def __init__(self, message: str = "禁止访问") -> None:
        super().__init__(message, 403)


class ValidationException(BusinessException):
    """数据验证异常"""

    def __init__(self, message: str = "数据验证失败") -> None:
        super().__init__(message, 422)


class ConflictException(BusinessException):
    """数据冲突异常"""

    def __init__(self, message: str = "数据冲突") -> None:
        super().__init__(message, 409)


# ===== 异常处理器 =====


async def business_exception_handler(request: Request, exc: BusinessException) -> JSONResponse:
    """业务异常处理器"""
    logger.warning(f"业务异常: {exc.message} (路径: {request.url.path}, 状态码: {exc.code})")
    return JSONResponse(status_code=exc.code, content={"success": False, "message": exc.message})


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """HTTP 异常处理器"""
    logger.warning(f"HTTP异常: {exc.detail} (路径: {request.url.path}, 状态码: {exc.status_code})")
    if isinstance(exc.detail, dict):
        message = exc.detail.get("message") or exc.detail.get("code") or "request failed"
        content = {"success": False, "message": message, "detail": exc.detail}
        if exc.detail.get("code"):
            content["error_code"] = exc.detail["code"]
    else:
        content = {"success": False, "message": exc.detail}
    return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """全局异常处理器 - 捕获所有未处理的异常"""
    logger.error(f"未处理异常: {exc} (路径: {request.url.path})", exc_info=True)
    return JSONResponse(status_code=500, content={"success": False, "message": "服务器内部错误，请稍后重试"})


# ===== 注册异常处理器 =====


def register_exception_handlers(app: FastAPI) -> None:
    """注册全局异常处理器

    Args:
        app: FastAPI 应用实例
    """
    app.add_exception_handler(BusinessException, business_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(Exception, global_exception_handler)
