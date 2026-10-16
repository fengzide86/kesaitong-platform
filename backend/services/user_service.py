"""
用户服务模块
包含用户 CRUD、统计、分页查询等业务逻辑
"""
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import case, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.logging import get_logger
from core.pagination import PaginationParams, paginate
from core.response import ErrorCodes, error_response, success_response
from core.timestamps import utc_iso
from domains.access import effective_license_status_sql
from domains.access.admin_context import authorization_context
from models import AuthCode, Device, User

logger = get_logger(__name__)


class UserService:
    """用户服务"""
    
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
    
    async def get_users_list(
        self,
        keyword: str | None = None,
        pagination: PaginationParams | None = None,
        platform_key: str | None = None,
        auth_code_id: int | None = None,
    ) -> dict[str, Any]:
        """获取用户列表（支持搜索和分页）"""
        query = select(User).order_by(desc(User.created_at))
        if auth_code_id is not None:
            query = query.where(User.auth_code_id == auth_code_id)
        if platform_key:
            scope = AuthCode.platform_scope
            scope_filter = or_(scope == platform_key, scope.like(f"{platform_key},%"), scope.like(f"%,{platform_key},%"), scope.like(f"%,{platform_key}"))
            if platform_key == "amazon":
                scope_filter = or_(scope_filter, scope.is_(None), scope == "")
            query = query.join(AuthCode, User.auth_code_id == AuthCode.id).where(scope_filter)
        
        # 关键词搜索
        if keyword:
            query = query.where(
                or_(*(func.coalesce(column, "").contains(keyword, autoescape=True) for column in (User.name, User.device_name, User.device_id, User.phone)))
            )
        
        if pagination:
            items, total = await paginate(query, self.db, pagination)
            contexts = await authorization_context(self.db, [u.auth_code_id for u in items if u.auth_code_id])
            return success_response(
                data=[{**self._serialize_user(u), **contexts.get(u.auth_code_id, {})} for u in items],
                total=total,
                page=pagination.page,
                page_size=pagination.page_size,
            )
        else:
            result = await self.db.execute(query)
            users = result.scalars().all()
            contexts = await authorization_context(self.db, [u.auth_code_id for u in users if u.auth_code_id])
            return success_response(
                data=[{**self._serialize_user(u), **contexts.get(u.auth_code_id, {})} for u in users]
            )
    
    async def get_user_by_id(self, user_id: int, platform_key: str | None = None) -> dict[str, Any]:
        """根据 ID 获取用户详情"""
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()
        
        if not user:
            return error_response("用户不存在", ErrorCodes.RESOURCE_NOT_FOUND)
        if platform_key:
            code = await self.db.get(AuthCode, user.auth_code_id) if user.auth_code_id else None
            scope = (code.platform_scope or "amazon").split(",") if code else []
            if platform_key not in [item.strip() for item in scope]:
                raise HTTPException(status_code=403, detail="该用户不属于当前平台，请切换平台后查看")
        
        contexts = await authorization_context(self.db, [user.auth_code_id] if user.auth_code_id else [])
        return success_response(data={**self._serialize_user(user, detailed=True), **contexts.get(user.auth_code_id, {})})
    
    async def update_user(
        self,
        user_id: int,
        data: dict,
        actor: dict | None = None,
        request: Request | None = None,
    ) -> dict[str, Any]:
        """更新用户信息"""
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()
        
        if not user:
            return error_response("用户不存在", ErrorCodes.RESOURCE_NOT_FOUND)

        before = self._serialize_user(user, detailed=True)
        # 更新字段
        updatable_fields = ["name", "phone", "total_seats", "extra_devices", "is_active"]
        for field in updatable_fields:
            if field in data:
                setattr(user, field, data[field])
        
        try:
            if actor:
                await log_admin_action(
                    self.db,
                    user_id=actor.get("staff_id"),
                    user_name=actor.get("username"),
                    action="user_update",
                    target_type="user",
                    target_id=user.id,
                    detail={
                        "role": actor.get("role"),
                        "before": before,
                        "after": self._serialize_user(user, detailed=True),
                        "reason": None,
                    },
                    request=request,
                )
            await self.db.commit()
            await self.db.refresh(user)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"更新用户失败: {e}")
            return error_response("更新用户失败", ErrorCodes.DATABASE_ERROR)
        
        logger.info(f"更新用户: {user.name or user.id} (ID: {user.id})")
        return success_response(data=self._serialize_user(user), message="更新成功")
    
    async def get_user_devices(self, user_id: int) -> dict[str, Any]:
        """获取用户的设备列表"""
        # 先获取用户的授权码
        user_result = await self.db.execute(select(User).where(User.id == user_id))
        user = user_result.scalars().first()
        
        if not user:
            return error_response("用户不存在", ErrorCodes.RESOURCE_NOT_FOUND)
        
        if not user.auth_code_id:
            return success_response(data=[])
        
        # 查询设备
        devices_result = await self.db.execute(
            select(Device).where(Device.auth_code_id == user.auth_code_id)
        )
        devices = devices_result.scalars().all()
        
        return success_response(data=[
            {
                "id": d.id,
                "device_id": d.device_id,
                "device_name": d.device_name,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in devices
        ])
    
    async def get_user_stats(self) -> dict[str, Any]:
        """获取用户统计"""
        today_start = datetime.combine(datetime.now().date(), datetime.min.time())
        tomorrow_start = today_start + timedelta(days=1)
        active_code_ids = select(AuthCode.id).where(effective_license_status_sql() == "active")
        total_users, active_users, today_new = (
            await self.db.execute(
                select(
                    func.count(User.id),
                    func.coalesce(
                        func.sum(case((User.auth_code_id.in_(active_code_ids), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (User.created_at >= today_start)
                                    & (User.created_at < tomorrow_start),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                )
            )
        ).one()
        
        return success_response(data={
            "total_users": total_users,
            "active_users": active_users,
            "today_new": today_new,
        })
    
    def _serialize_user(self, user: User, detailed: bool = False) -> dict:
        """序列化用户对象"""
        data = {
            "id": user.id,
            "auth_code_id": user.auth_code_id,
            "name": user.name,
            "phone": user.phone,
            "device_id": user.device_id,
            "device_name": user.device_name,
            "total_seats": user.total_seats,
            "extra_devices": user.extra_devices,
            "is_active": user.is_active,
            "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
            # Created by the UTC database default (SQLite CURRENT_TIMESTAMP;
            # MySQL sessions SET +00:00), not a client-local wall clock.
            "created_at": utc_iso(user.created_at),
        }
        
        if detailed:
            data["last_active_at"] = user.last_active_at.isoformat() if user.last_active_at else None
            data["updated_at"] = user.updated_at.isoformat() if user.updated_at else None
        
        return data
