"""
分页模块
提供标准化的分页查询功能
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select


@dataclass
class PaginationParams:
    """分页参数"""

    page: int = Query(1, ge=1, description="页码（从1开始）")
    page_size: int = Query(20, ge=1, le=100, description="每页数量（1-100）")

    @property
    def offset(self) -> int:
        """计算偏移量"""
        return (self.page - 1) * self.page_size


@dataclass
class PageInfo:
    """分页信息"""

    page: int
    page_size: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool

    @classmethod
    def create(cls, page: int, page_size: int, total: int) -> "PageInfo":
        """创建分页信息"""
        total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
        return cls(
            page=page,
            page_size=page_size,
            total=total,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_prev=page > 1,
        )

    def to_dict(self) -> dict[str, int | bool]:
        """转换为字典"""
        return {
            "page": self.page,
            "page_size": self.page_size,
            "total": self.total,
            "total_pages": self.total_pages,
            "has_next": self.has_next,
            "has_prev": self.has_prev,
        }


@dataclass
class PaginatedResult[T]:
    """分页查询结果"""

    items: list[T]
    page_info: PageInfo

    def to_response(
        self,
        serializer: Callable[[T], Any] | None = None,
    ) -> dict[str, Any]:
        """转换为响应格式

        Args:
            serializer: 可选的序列化函数，用于转换每个项目
        """
        if serializer:
            data = [serializer(item) for item in self.items]
        else:
            data = self.items

        return {
            "success": True,
            "message": "ok",
            "data": data,
            "total": self.page_info.total,
            "page": self.page_info.page,
            "page_size": self.page_info.page_size,
            "total_pages": self.page_info.total_pages,
        }


async def paginate(query: Select, db: AsyncSession, pagination: PaginationParams) -> tuple[list[Any], int]:
    """执行分页查询

    Args:
        query: SQLAlchemy 查询对象
        db: 数据库会话
        pagination: 分页参数

    Returns:
        (items, total) 元组
    """
    # 计算总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 执行分页查询
    paginated_query = query.offset(pagination.offset).limit(pagination.page_size)
    result = await db.execute(paginated_query)
    items = list(result.scalars().all())

    return items, total


async def paginate_with_info(query: Select, db: AsyncSession, pagination: PaginationParams) -> PaginatedResult:
    """执行分页查询并返回完整分页结果

    Args:
        query: SQLAlchemy 查询对象
        db: 数据库会话
        pagination: 分页参数

    Returns:
        PaginatedResult 对象
    """
    items, total = await paginate(query, db, pagination)
    page_info = PageInfo.create(pagination.page, pagination.page_size, total)
    return PaginatedResult(items=items, page_info=page_info)


def get_pagination_params(
    page: int = Query(1, ge=1, description="页码"), page_size: int = Query(20, ge=1, le=100, description="每页数量")
) -> PaginationParams:
    """获取分页参数（用于依赖注入）

    Usage:
        @router.get("/items")
        async def get_items(pagination: PaginationParams = Depends(get_pagination_params)):
            ...
    """
    return PaginationParams(page=page, page_size=page_size)


# ===== 常用分页大小预设 =====
class PageSize:
    """预设分页大小"""

    SMALL = 10
    MEDIUM = 20
    LARGE = 50
    XLARGE = 100
