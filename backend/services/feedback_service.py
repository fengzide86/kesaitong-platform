"""
工单反馈服务模块
包含工单 CRUD、状态管理、分页查询等业务逻辑
"""
from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from core.logging import get_logger
from core.pagination import PaginationParams, paginate
from core.response import ErrorCodes, error_response, success_response
from core.timestamps import utc_iso, utc_now
from models import Feedback

logger = get_logger(__name__)


class FeedbackService:
    """工单反馈服务"""
    
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
    
    async def get_feedback_list(
        self,
        status: str | None = None,
        user_id: int | None = None,
        platform_key: str | None = None,
        pagination: PaginationParams | None = None
    ) -> dict[str, Any]:
        """获取工单列表（支持过滤和分页）"""
        query = select(Feedback)
        # Operations should see unresolved work before recent closed tickets.
        # A user's own history retains chronological ordering.
        if user_id is None and not status:
            query = query.order_by(case((Feedback.status == "pending", 0), (Feedback.status == "processing", 1), else_=2))
        query = query.order_by(desc(Feedback.created_at), desc(Feedback.id))
        
        # 状态过滤
        if status:
            query = query.where(Feedback.status == status)
        
        # 用户过滤
        if user_id:
            query = query.where(Feedback.user_id == user_id)
        
        # 平台过滤（1.5 新增）
        if platform_key:
            query = query.where(Feedback.platform_key == platform_key)
        
        if pagination:
            items, total = await paginate(query, self.db, pagination)
            return success_response(
                data=[self._serialize_feedback(f) for f in items],
                total=total,
                page=pagination.page,
                page_size=pagination.page_size,
            )
        else:
            result = await self.db.execute(query)
            feedbacks = result.scalars().all()
            return success_response(
                data=[self._serialize_feedback(f) for f in feedbacks]
            )
    
    async def get_feedback_by_id(self, feedback_id: int, platform_key: str | None = None) -> dict[str, Any]:
        """根据 ID 获取工单详情"""
        result = await self.db.execute(
            select(Feedback).where(Feedback.id == feedback_id)
        )
        feedback = result.scalars().first()
        
        if not feedback:
            return error_response("工单不存在", ErrorCodes.RESOURCE_NOT_FOUND)
        if platform_key and feedback.platform_key != platform_key:
            raise HTTPException(status_code=403, detail="该工单不属于当前平台，请切换平台后查看")
        
        return success_response(data=self._serialize_feedback(feedback, detailed=True))
    
    async def create_feedback(self, data: dict) -> dict[str, Any]:
        """创建工单"""
        feedback = Feedback(
            user_id=data.get("user_id"),
            title=data.get("title", ""),
            content=data.get("content", ""),
            screenshot=data.get("screenshot"),
            screenshots=data.get("screenshots"),
            status="pending",
            priority=data.get("priority", "normal"),
            platform_key=data.get("platform_key"),
            capability_key=data.get("capability_key"),
            tool_id=data.get("tool_id"),
            run_log_id=data.get("run_log_id"),
        )
        self.db.add(feedback)
        
        try:
            await self.db.commit()
            await self.db.refresh(feedback)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"创建工单失败: {e}")
            return error_response("创建工单失败", ErrorCodes.DATABASE_ERROR)
        
        logger.info(f"创建工单: {feedback.title} (ID: {feedback.id})")
        return success_response(data=self._serialize_feedback(feedback), message="创建成功")
    
    async def update_feedback(
        self,
        feedback_id: int,
        data: dict,
        actor: dict | None = None,
        request: Request | None = None,
    ) -> dict[str, Any]:
        """更新工单"""
        result = await self.db.execute(
            select(Feedback).where(Feedback.id == feedback_id)
        )
        feedback = result.scalars().first()
        
        if not feedback:
            return error_response("工单不存在", ErrorCodes.RESOURCE_NOT_FOUND)

        before = self._serialize_feedback(feedback, detailed=True)
        # 更新字段
        updatable_fields = ["title", "content", "status", "priority", "admin_reply"]
        for field in updatable_fields:
            if field in data:
                setattr(feedback, field, data[field])
        
        # 如果有管理员回复，更新回复时间
        if "admin_reply" in data and data["admin_reply"]:
            feedback.replied_at = utc_now()
        
        try:
            if actor:
                await log_admin_action(
                    self.db,
                    user_id=actor.get("staff_id"),
                    user_name=actor.get("username"),
                    action="feedback_update",
                    target_type="feedback",
                    target_id=feedback.id,
                    detail={
                        "role": actor.get("role"),
                        "before": before,
                        "after": self._serialize_feedback(feedback, detailed=True),
                        "reason": None,
                    },
                    request=request,
                )
            await self.db.commit()
            await self.db.refresh(feedback)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"更新工单失败: {e}")
            return error_response("更新工单失败", ErrorCodes.DATABASE_ERROR)
        
        logger.info(f"更新工单: {feedback.id} -> {feedback.status}")
        return success_response(data=self._serialize_feedback(feedback), message="更新成功")
    
    async def delete_feedback(
        self,
        feedback_id: int,
        actor: dict | None = None,
        request: Request | None = None,
    ) -> dict[str, Any]:
        """删除工单"""
        result = await self.db.execute(
            select(Feedback).where(Feedback.id == feedback_id)
        )
        feedback = result.scalars().first()
        
        if not feedback:
            return error_response("工单不存在", ErrorCodes.RESOURCE_NOT_FOUND)

        before = self._serialize_feedback(feedback, detailed=True)
        try:
            await self.db.delete(feedback)
            if actor:
                await log_admin_action(
                    self.db,
                    user_id=actor.get("staff_id"),
                    user_name=actor.get("username"),
                    action="feedback_delete",
                    target_type="feedback",
                    target_id=feedback.id,
                    detail={
                        "role": actor.get("role"),
                        "before": before,
                        "after": {"deleted": True},
                        "reason": None,
                    },
                    request=request,
                )
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.error(f"删除工单失败: {e}")
            return error_response("删除工单失败", ErrorCodes.DATABASE_ERROR)
        
        logger.info(f"删除工单: {feedback.id}")
        return success_response(message="删除成功")
    
    async def get_feedback_stats(self) -> dict[str, Any]:
        """获取工单统计"""
        # 各状态数量
        stats_result = await self.db.execute(
            select(
                func.count(Feedback.id),
                func.sum(case((Feedback.status == "pending", 1), else_=0)),
                func.sum(case((Feedback.status == "processing", 1), else_=0)),
                func.sum(case((Feedback.status == "resolved", 1), else_=0)),
            )
        )
        total, pending, processing, resolved = stats_result.one()
        
        return success_response(data={
            "total": total or 0,
            "pending": pending or 0,
            "processing": processing or 0,
            "resolved": resolved or 0,
        })
    
    def _serialize_feedback(self, feedback: Feedback, detailed: bool = False) -> dict:
        """序列化反馈对象"""
        data = {
            "id": feedback.id,
            "user_id": feedback.user_id,
            "title": feedback.title,
            "content": feedback.content,
            "status": feedback.status,
            "priority": feedback.priority,
            "admin_reply": feedback.admin_reply,
            "created_at": utc_iso(feedback.created_at),
            "replied_at": utc_iso(feedback.replied_at),
            "updated_at": utc_iso(feedback.updated_at),
            "platform_key": feedback.platform_key,
            "capability_key": feedback.capability_key,
            "tool_id": feedback.tool_id,
        }
        
        if detailed:
            data["screenshot"] = feedback.screenshot
            data["screenshots"] = feedback.screenshots
            data["status_history"] = feedback.status_history
            data["run_log_id"] = feedback.run_log_id
        
        return data
