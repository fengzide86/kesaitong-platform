"""
Token 黑名单模块
用于使 JWT Token 失效（如用户登出、修改密码等场景）
"""

from datetime import UTC, datetime
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


class TokenBlacklist:
    """Token 黑名单管理器

    支持两种存储模式：
    1. 内存模式（开发环境）：使用 Python set 存储
    2. Redis 模式（生产环境）：使用 Redis set 存储，支持多实例共享
    """

    def __init__(self) -> None:
        self._memory_blacklist: dict[str, datetime] = {}  # token -> 过期时间
        self._redis: Any | None = None
        self._initialized = False

    async def init(self, redis_client: Any | None = None) -> None:
        """初始化黑名单

        Args:
            redis_client: Redis 客户端实例（可选）
        """
        if self._initialized:
            return

        if redis_client:
            self._redis = redis_client
            logger.info("Token 黑名单使用 Redis 存储")
        else:
            logger.info("Token 黑名单使用内存存储")

        self._initialized = True

    async def add(self, token: str, expires_at: datetime) -> bool:
        """将 Token 加入黑名单

        Args:
            token: JWT Token
            expires_at: Token 原始过期时间（用于自动清理）

        Returns:
            是否成功添加
        """
        if self._redis:
            try:
                # 计算剩余时间
                ttl = int((expires_at - datetime.now(UTC)).total_seconds())
                if ttl <= 0:
                    return False  # Token 已过期，无需加入黑名单

                # 使用 Redis key 存储，自动过期
                key = f"token_blacklist:{token}"
                await self._redis.setex(key, ttl, "1")
                return True
            except Exception as e:
                logger.error(f"Redis 添加黑名单失败: {e}")
                return False
        else:
            # 内存模式
            self._cleanup_expired()
            self._memory_blacklist[token] = expires_at
            return True

    async def is_blacklisted(self, token: str) -> bool:
        """检查 Token 是否在黑名单中

        Args:
            token: JWT Token

        Returns:
            Token 是否已被拉黑
        """
        if self._redis:
            try:
                key = f"token_blacklist:{token}"
                result = await self._redis.exists(key)
                return result > 0
            except Exception as e:
                logger.error(f"Redis 检查黑名单失败: {e}")
                return False
        else:
            self._cleanup_expired()
            return token in self._memory_blacklist

    async def remove(self, token: str) -> bool:
        """从黑名单移除 Token（如恢复登出）

        Args:
            token: JWT Token

        Returns:
            是否成功移除
        """
        if self._redis:
            try:
                key = f"token_blacklist:{token}"
                await self._redis.delete(key)
                return True
            except Exception as e:
                logger.error(f"Redis 移除黑名单失败: {e}")
                return False
        else:
            self._memory_blacklist.pop(token, None)
            return True

    async def clear_all(self) -> int:
        """清空所有黑名单（谨慎使用）

        Returns:
            清除的 Token 数量
        """
        if self._redis:
            try:
                cursor = 0
                count = 0
                while True:
                    cursor, keys = await self._redis.scan(cursor, match="token_blacklist:*", count=100)
                    if keys:
                        count += await self._redis.delete(*keys)
                    if cursor == 0:
                        break
                return count
            except Exception as e:
                logger.error(f"Redis 清空黑名单失败: {e}")
                return 0
        else:
            count = len(self._memory_blacklist)
            self._memory_blacklist.clear()
            return count

    def _cleanup_expired(self) -> None:
        """清理过期的黑名单条目（仅内存模式）"""
        now = datetime.now(UTC)
        expired_tokens = [token for token, expires_at in self._memory_blacklist.items() if expires_at < now]
        for token in expired_tokens:
            del self._memory_blacklist[token]

    @property
    def size(self) -> int:
        """黑名单大小"""
        if self._redis:
            # Redis 模式下无法直接获取大小，返回 -1
            return -1
        return len(self._memory_blacklist)


# ===== 用户登出记录 =====


class LogoutManager:
    """用户登出管理器

    记录用户登出时间，用于使该时间之前签发的所有 Token 失效
    """

    def __init__(self) -> None:
        self._logout_times: dict[int, datetime] = {}  # user_id -> 登出时间
        self._redis: Any | None = None
        self._initialized = False

    async def init(self, redis_client: Any | None = None) -> None:
        """初始化"""
        if self._initialized:
            return

        self._redis = redis_client
        self._initialized = True

    async def record_logout(self, user_id: int) -> bool:
        """记录用户登出

        Args:
            user_id: 用户ID

        Returns:
            是否成功记录
        """
        logout_time = datetime.now(UTC)

        if self._redis:
            try:
                key = f"logout_time:{user_id}"
                # 保存24小时（与 Token 最大有效期一致）
                await self._redis.setex(key, 86400, logout_time.isoformat())
                return True
            except Exception as e:
                logger.error(f"Redis 记录登出失败: {e}")
                return False
        else:
            self._logout_times[user_id] = logout_time
            return True

    async def get_logout_time(self, user_id: int) -> datetime | None:
        """获取用户最后登出时间

        Args:
            user_id: 用户ID

        Returns:
            最后登出时间，如果未登出过返回 None
        """
        if self._redis:
            try:
                key = f"logout_time:{user_id}"
                result = await self._redis.get(key)
                if result:
                    return datetime.fromisoformat(result)
                return None
            except Exception as e:
                logger.error(f"Redis 获取登出时间失败: {e}")
                return None
        else:
            return self._logout_times.get(user_id)

    async def is_token_valid_after_logout(self, user_id: int, token_issued_at: datetime) -> bool:
        """检查 Token 是否在登出后签发

        Args:
            user_id: 用户ID
            token_issued_at: Token 签发时间

        Returns:
            Token 是否有效（在登出之前签发）
        """
        logout_time = await self.get_logout_time(user_id)
        if not logout_time:
            return True  # 从未登出过

        return token_issued_at > logout_time


# ===== 全局实例 =====
token_blacklist = TokenBlacklist()
logout_manager = LogoutManager()


# ===== 便捷函数 =====


async def blacklist_token(token: str, expires_at: datetime) -> bool:
    """将 Token 加入黑名单"""
    return await token_blacklist.add(token, expires_at)


async def is_token_blacklisted(token: str) -> bool:
    """检查 Token 是否在黑名单中"""
    return await token_blacklist.is_blacklisted(token)


async def record_user_logout(user_id: int) -> bool:
    """记录用户登出"""
    return await logout_manager.record_logout(user_id)


async def check_token_after_logout(user_id: int, issued_at: datetime) -> bool:
    """检查 Token 是否在登出后仍然有效"""
    return await logout_manager.is_token_valid_after_logout(user_id, issued_at)
