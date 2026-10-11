"""
异步任务模块
提供后台任务执行功能，避免阻塞主请求
"""

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from functools import wraps
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


class TaskManager:
    """任务管理器"""

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[Any]] = set()
        self._running = True

    def create_task(
        self,
        coro: Coroutine[Any, Any, Any],
        name: str | None = None,
    ) -> asyncio.Task[Any] | None:
        """创建后台任务

        Args:
            coro: 协程对象
            name: 任务名称（用于日志）

        Returns:
            asyncio.Task 对象
        """
        if not self._running:
            logger.warning(f"任务管理器已关闭，无法创建任务: {name}")
            return None

        task = asyncio.create_task(coro, name=name)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

        if name:
            logger.debug(f"创建后台任务: {name}")

        return task

    async def shutdown(self, timeout: float = 5.0) -> None:
        """关闭任务管理器，等待所有任务完成

        Args:
            timeout: 最大等待时间（秒）
        """
        self._running = False

        if not self._tasks:
            logger.info("没有待完成的后台任务")
            return

        logger.info(f"正在关闭任务管理器，等待 {len(self._tasks)} 个任务完成...")

        # 取消所有任务
        for task in self._tasks:
            task.cancel()

        # 等待任务完成
        try:
            await asyncio.wait_for(asyncio.gather(*self._tasks, return_exceptions=True), timeout=timeout)
        except TimeoutError:
            logger.warning(f"任务关闭超时 ({timeout}s)，强制结束")

        logger.info("任务管理器已关闭")

    @property
    def pending_count(self) -> int:
        """待完成任务数"""
        return len([t for t in self._tasks if not t.done()])


# 全局任务管理器
task_manager = TaskManager()


# ===== 装饰器 =====


def background_task(func: Callable[..., Any]) -> Callable[..., Any]:
    """后台任务装饰器

    将被装饰的函数作为后台任务执行，不阻塞主流程

    Usage:
        @background_task
        async def send_notification(user_id: int, message: str):
            # 发送通知的耗时操作
            ...

        # 调用时不会阻塞
        await send_notification(1, "Hello")
    """

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> asyncio.Task[Any] | None:
        task_name = f"{func.__module__}.{func.__name__}"
        return task_manager.create_task(func(*args, **kwargs), name=task_name)

    return wrapper


def fire_and_forget(func: Callable[..., Any]) -> Callable[..., Any]:
    """即发即忘装饰器

    与 background_task 类似，但会捕获并记录所有异常

    Usage:
        @fire_and_forget
        async def log_action(user_id: int, action: str):
            # 记录日志
            ...
    """

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> asyncio.Task[Any] | None:
        async def _safe_execute() -> None:
            try:
                await func(*args, **kwargs)
            except asyncio.CancelledError:
                logger.debug(f"任务被取消: {func.__name__}")
            except Exception as e:
                logger.error(f"后台任务异常 [{func.__name__}]: {e}", exc_info=True)

        task_name = f"{func.__module__}.{func.__name__}"
        return task_manager.create_task(_safe_execute(), name=task_name)

    return wrapper


# ===== 常用后台任务 =====


@fire_and_forget
async def delayed_execute(delay: float, coro: Awaitable[Any]) -> None:
    """延迟执行任务

    Args:
        delay: 延迟秒数
        coro: 要执行的协程
    """
    await asyncio.sleep(delay)
    await coro


@fire_and_forget
async def retry_with_backoff(
    func: Callable[..., Any],
    max_retries: int = 3,
    base_delay: float = 1.0,
    *args: Any,
    **kwargs: Any,
) -> Any:
    """带指数退避的重试任务

    Args:
        func: 要执行的异步函数
        max_retries: 最大重试次数
        base_delay: 基础延迟秒数
        *args, **kwargs: 传递给函数的参数
    """
    for attempt in range(max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            if attempt == max_retries:
                logger.error(f"任务重试 {max_retries} 次后仍失败: {e}")
                raise

            delay = base_delay * (2**attempt)
            logger.warning(f"任务失败，{delay}s 后重试 ({attempt + 1}/{max_retries}): {e}")
            await asyncio.sleep(delay)


class PeriodicTask:
    """周期性任务

    Usage:
        async def cleanup():
            # 清理过期数据
            ...

        task = PeriodicTask(cleanup, interval=3600)  # 每小时执行
        task.start()

        # 停止
        task.stop()
    """

    def __init__(
        self,
        func: Callable[[], Awaitable[Any]],
        interval: float,
        name: str | None = None,
    ) -> None:
        """
        Args:
            func: 要周期性执行的异步函数
            interval: 执行间隔（秒）
            name: 任务名称
        """
        self.func = func
        self.interval = interval
        self.name = name or func.__name__
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        """启动周期任务"""
        if self._running:
            return

        self._running = True
        self._task = task_manager.create_task(self._run(), name=f"periodic:{self.name}")
        logger.info(f"周期任务已启动: {self.name} (间隔: {self.interval}s)")

    def stop(self) -> None:
        """停止周期任务"""
        self._running = False
        if self._task:
            self._task.cancel()
            logger.info(f"周期任务已停止: {self.name}")

    async def _run(self) -> None:
        """内部运行方法"""
        while self._running:
            try:
                await self.func()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"周期任务异常 [{self.name}]: {e}", exc_info=True)

            try:
                await asyncio.sleep(self.interval)
            except asyncio.CancelledError:
                break
