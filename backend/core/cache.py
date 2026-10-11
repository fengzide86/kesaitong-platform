"""
缓存管理模块
支持 Redis 缓存，提供统一的缓存接口
"""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from typing import Any

from core.config import settings
from core.logging import get_logger, redact_sensitive

logger = get_logger(__name__)


class CacheManager:
    """缓存管理器"""

    def __init__(self) -> None:
        self.redis: Any | None = None
        self.redis_error: str | None = None
        self._initialized = False
        self._init_lock = asyncio.Lock()
        self._next_retry_at = 0.0
        self.retry_interval = 5.0
        self.operation_timeout = 2.0

    def _failed(self, action: str, error: Exception) -> None:
        self.redis_error = str(redact_sensitive(str(error))) or type(error).__name__
        self._next_retry_at = time.monotonic() + self.retry_interval
        # A cache key may contain an authorization code; do not log keys/URLs.
        logger.warning("Redis %s 失败 (%s): %s", action, type(error).__name__, self.redis_error)

    def _healthy(self) -> None:
        recovered = self.redis_error is not None
        self.redis_error = None
        self._next_retry_at = 0.0
        if recovered:
            logger.info("Redis 连接已恢复")

    async def _operation(self, action: str, operation: Callable[[], Awaitable[Any]]) -> Any:
        try:
            result = await asyncio.wait_for(operation(), timeout=self.operation_timeout)
            self._healthy()
            return result
        except Exception as error:
            self._failed(action, error)
            raise

    async def init(self) -> None:
        """Initialize once, but retry a failed connection without restarting.

        Keep a stable client pool after a failed PING. Blacklist/logout users of
        the same client can reconnect too; never silently replace their client
        with an unrelated in-memory store on a transient startup failure.
        """
        if self._initialized and self.redis_error is None:
            return
        if self.redis_error and time.monotonic() < self._next_retry_at:
            return
        async with self._init_lock:
            if self._initialized and self.redis_error is None:
                return
            if not settings.REDIS_URL:
                logger.info("未配置 Redis，缓存功能停用；本机认证后备存储由各模块管理")
                self.redis_error = None
                self._initialized = True
                return
            try:
                if self.redis is None:
                    import redis.asyncio as aioredis
                    self.redis = aioredis.from_url(
                        settings.REDIS_URL, encoding="utf-8", decode_responses=True,
                        socket_connect_timeout=1.0, socket_timeout=1.0,
                        health_check_interval=30, retry_on_timeout=False,
                    )
                await self._operation("PING", self.redis.ping)
                logger.info("Redis 连接成功")
                self._initialized = True
            except Exception:
                # The failed operation already recorded safe, bounded detail.
                self._initialized = True

    async def check_health(self) -> dict[str, Any]:
        if self.redis is None and not settings.REDIS_URL:
            return {"status": "not_configured"}
        if self.redis is None:
            await self.init()
        if self.redis_error and time.monotonic() < self._next_retry_at:
            return {"status": "error", "error": self.redis_error}
        if self.redis is not None:
            try:
                await self._operation("PING", self.redis.ping)
                return {"status": "ok"}
            except Exception:
                pass
        return {"status": "error", "error": self.redis_error or "Redis 已配置但连接不可用"}

    async def _ready_client(self) -> Any | None:
        if self.redis is None:
            await self.init()
        if self.redis_error and time.monotonic() < self._next_retry_at:
            return None
        return self.redis

    async def get(self, key: str) -> Any | None:
        """获取缓存数据"""
        client = await self._ready_client()
        if client is not None:
            try:
                data = await self._operation("GET", lambda: client.get(key))
                if data:
                    return json.loads(data)
            except Exception:
                pass
        return None

    async def set(self, key: str, value: Any, ttl: int = 300) -> bool:
        """设置缓存数据

        Args:
            key: 缓存键
            value: 缓存值（必须是 JSON 可序列化的）
            ttl: 过期时间（秒），默认5分钟
        """
        client = await self._ready_client()
        if client is not None:
            try:
                data = json.dumps(value, ensure_ascii=False, default=str)
                await self._operation("SET", lambda: client.setex(key, ttl, data))
                return True
            except Exception:
                pass
        return False

    async def delete(self, key: str) -> bool:
        """删除缓存"""
        client = await self._ready_client()
        if client is not None:
            try:
                await self._operation("DELETE", lambda: client.delete(key))
                return True
            except Exception:
                pass
        return False

    async def delete_pattern(self, pattern: str) -> int:
        """批量删除匹配模式的缓存

        Args:
            pattern: 匹配模式，如 "plans:*"

        Returns:
            删除的键数量
        """
        client = await self._ready_client()
        if client is not None:
            try:
                async def scan_and_delete() -> int:
                    cursor = 0
                    deleted_count = 0
                    while True:
                        cursor, keys = await client.scan(cursor, match=pattern, count=100)
                        if keys:
                            deleted_count += await client.delete(*keys)
                        if cursor == 0:
                            return deleted_count
                return int(await self._operation("DELETE_PATTERN", scan_and_delete))
            except Exception:
                pass
        return 0

    async def exists(self, key: str) -> bool:
        """检查键是否存在"""
        client = await self._ready_client()
        if client is not None:
            try:
                return bool(await self._operation("EXISTS", lambda: client.exists(key)) > 0)
            except Exception:
                pass
        return False

    async def incr(self, key: str, amount: int = 1, ttl: int | None = None) -> int | None:
        """原子递增"""
        client = await self._ready_client()
        if client is not None:
            try:
                async def increment() -> int:
                    value = await client.incrby(key, amount)
                    if ttl and value == amount:
                        await client.expire(key, ttl)
                    return int(value)
                return int(await self._operation("INCR", increment))
            except Exception:
                pass
        return None

    async def get_ttl(self, key: str) -> int:
        """获取键的剩余过期时间（秒）"""
        client = await self._ready_client()
        if client is not None:
            try:
                return int(await self._operation("TTL", lambda: client.ttl(key)))
            except Exception:
                pass
        return -1

    async def close(self) -> None:
        """关闭 Redis 连接"""
        if self.redis:
            try:
                closer = getattr(self.redis, "aclose", None) or self.redis.close
                await asyncio.wait_for(closer(), timeout=self.operation_timeout)
                logger.info("Redis 连接已关闭")
            except Exception as error:
                self._failed("CLOSE", error)
        self.redis = None
        self._initialized = False
        self._next_retry_at = 0.0


# ===== 缓存键常量 =====
class CacheKeys:
    """缓存键定义

    统一命名规范: {module}:{entity}:{identifier}
    """

    # 套餐相关
    PLANS_LIST = "plans:list:all"
    PLAN_DETAIL = "plans:detail:{plan_id}"

    # 设置相关
    SETTINGS_ALL = "settings:global:all"
    SETTING_KEY = "settings:item:{key}"

    # 用户相关
    USER_INFO = "users:detail:{user_id}"
    USER_AUTH_CODE = "users:auth:{user_id}"
    USERS_LIST = "users:list:{platform}"

    # 授权码相关
    AUTH_CODE_INFO = "auth_codes:detail:{code}"
    AUTH_CODES_LIST = "auth_codes:list:{platform}"

    # Dashboard 相关
    DASHBOARD_STATS = "dashboard:stats:{platform}"
    DASHBOARD_CHARTS = "dashboard:charts:{platform}"

    # 工具相关
    TOOLS_LIST = "tools:config:all"
    TOOLS_CATEGORIES = "tools:categories:all"

    # 分润相关
    PROFIT_LIST = "profit:list:{platform}"
    PROFIT_SUMMARY = "profit:summary:{platform}"

    # 公告相关
    ANNOUNCEMENTS_ACTIVE = "announcements:active:all"

    # 知识库相关
    KNOWLEDGE_LIST = "knowledge:list:{category}"
    KNOWLEDGE_CATEGORIES = "knowledge:categories:all"

    @classmethod
    def plan_detail(cls, plan_id: int) -> str:
        return cls.PLAN_DETAIL.format(plan_id=plan_id)

    @classmethod
    def setting_key(cls, key: str) -> str:
        return cls.SETTING_KEY.format(key=key)

    @classmethod
    def user_info(cls, user_id: int) -> str:
        return cls.USER_INFO.format(user_id=user_id)

    @classmethod
    def auth_code_info(cls, code: str) -> str:
        return cls.AUTH_CODE_INFO.format(code=code)

    @classmethod
    def dashboard_stats(cls, platform: str | None = "all") -> str:
        return cls.DASHBOARD_STATS.format(platform=platform or "all")

    @classmethod
    def dashboard_charts(cls, platform: str | None = "all") -> str:
        return cls.DASHBOARD_CHARTS.format(platform=platform or "all")

    @classmethod
    def users_list(cls, platform: str = "all") -> str:
        return cls.USERS_LIST.format(platform=platform or "all")

    @classmethod
    def auth_codes_list(cls, platform: str = "all") -> str:
        return cls.AUTH_CODES_LIST.format(platform=platform or "all")

    @classmethod
    def profit_list(cls, platform: str = "all") -> str:
        return cls.PROFIT_LIST.format(platform=platform or "all")

    @classmethod
    def profit_summary(cls, platform: str = "all") -> str:
        return cls.PROFIT_SUMMARY.format(platform=platform or "all")


# ===== 缓存装饰器 =====
def cache_result(
    ttl: int = 300,
    key_prefix: str = "",
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """缓存装饰器（用于函数）

    注意：这是一个简单的装饰器，实际使用建议直接调用 cache 方法
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 生成缓存键
            key_parts = [key_prefix or func.__name__]
            key_parts.extend(str(arg) for arg in args[:3])  # 只用前3个参数
            cache_key = ":".join(key_parts)

            # 尝试从缓存获取
            cached = await cache.get(cache_key)
            if cached is not None:
                return cached

            # 执行函数
            result = await func(*args, **kwargs)

            # 存入缓存
            await cache.set(cache_key, result, ttl)
            return result

        return wrapper

    return decorator


# 全局缓存实例
cache = CacheManager()
