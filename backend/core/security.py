"""
安全相关模块
包含密码哈希、JWT认证、CORS配置等安全功能
"""
import asyncio
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings

_PASSWORD_HASH_ROUNDS = 4 if settings.APP_ENV == "test" else 12

# ===== CORS 配置 =====

def configure_cors(app: FastAPI) -> None:
    """配置 CORS 中间件
    
    Args:
        app: FastAPI 应用实例
    """
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Toolbox-Version", "Idempotency-Key"],
        max_age=600,  # 预检请求缓存10分钟
    )


# ===== 密码哈希 =====

def hash_password(password: str) -> str:
    """密码哈希（使用 bcrypt）
    
    Args:
        password: 明文密码
        
    Returns:
        哈希后的密码字符串
    """
    return bcrypt.hashpw(
        password.encode('utf-8'),
        bcrypt.gensalt(rounds=_PASSWORD_HASH_ROUNDS),
    ).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    """验证密码
    
    Args:
        password: 明文密码
        hashed: 哈希后的密码
        
    Returns:
        密码是否匹配
    """
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


def verify_password_fallback(password: str, stored: str) -> tuple[bool, bool]:
    """验证密码（仅支持 bcrypt 哈希）
    
    Args:
        password: 明文密码
        stored: 存储的 bcrypt 哈希密码
        
    Returns:
        (是否匹配, 是否需要升级) - 第二个值始终为 False
    """
    # 仅支持 bcrypt 验证
    try:
        if bcrypt.checkpw(password.encode('utf-8'), stored.encode('utf-8')):
            return True, False
    except Exception:
        pass
    
    return False, False


async def hash_password_async(password: str) -> str:
    """Hash a password without blocking an async request worker."""
    return await asyncio.to_thread(hash_password, password)


async def verify_password_fallback_async(password: str, stored: str) -> tuple[bool, bool]:
    """Verify a password without blocking an async request worker."""
    return await asyncio.to_thread(verify_password_fallback, password, stored)


# ===== JWT Token =====

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """创建 JWT Token
    
    Args:
        data: 要编码的数据（如 {"user_id": 1, "role": "user"}）
        expires_delta: 过期时间增量，默认使用配置中的过期时间
        
    Returns:
        JWT Token 字符串
    """
    to_encode = data.copy()
    
    # 设置过期时间
    now = datetime.now(UTC)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    
    # 添加标准声明
    to_encode.update({
        "exp": expire,
        "iat": now,  # 签发时间
    })
    
    # 编码 Token
    encoded_jwt = jwt.encode(
        to_encode,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM
    )
    
    return encoded_jwt


def verify_token(token: str) -> dict | None:
    """验证 JWT Token
    
    Args:
        token: JWT Token 字符串
        
    Returns:
        Token 中的数据（payload），如果验证失败返回 None
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        # Token 已过期
        return None
    except jwt.InvalidTokenError:
        # Token 无效
        return None


def extract_token_from_header(authorization: str) -> str | None:
    """从 Authorization 头中提取 Token
    
    Args:
        authorization: Authorization 请求头的值
        
    Returns:
        Token 字符串，如果格式不正确返回 None
    """
    if not authorization:
        return None
    
    # 格式: "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    
    return parts[1]
