"""
认证服务模块
包含授权码验证、管理员登录、Token 管理等业务逻辑
"""
from datetime import datetime, timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.logging import get_logger
from core.response import ErrorCodes, error_response, success_response
from core.security import create_access_token
from domains.access import effective_license_status, normalize_entitlements, resolve_plan_code, resolve_product_access
from models import AuthCode, AuthSeat, Device, Plan, User
from services.staff_service import authenticate_staff, create_staff_access_token, staff_to_dict

logger = get_logger(__name__)


class AuthService:
    """认证服务"""
    
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
    
    async def verify_auth_code(
        self,
        code: str,
        device_id: str,
        device_name: str,
        platform_key: str | None = None
    ) -> dict[str, Any]:
        """授权码验证（用户登录）
        
        流程:
        1. 验证授权码是否存在
        2. 检查授权码状态（冻结、过期、删除）
        3. 检查平台权限（1.5 新增）
        4. 首次激活时创建用户记录
        5. 席位检查（1.5 新增）
        6. 多设备支持：检查设备绑定情况
        7. 返回 JWT Token
        
        优化: 缓存中间查询结果，避免重复查询（原约8次查询优化为5次）
        """
        code = code.strip()
        
        # 1. 锁定授权码行。首次激活、席位与设备计数必须在同一事务内串行，
        # 否则两个并发登录都可能在旧计数上创建记录并超卖配额。
        result = await self.db.execute(
            select(AuthCode, Plan.name, Plan.duration_days, Plan.product_type, Plan.entitlements)
            .outerjoin(Plan, AuthCode.plan_id == Plan.id)
            .where(AuthCode.code == code)
            .with_for_update()
        )
        row = result.first()
        
        if not row:
            return error_response("授权码无效", ErrorCodes.AUTH_CODE_INVALID)
        
        code_obj = row[0]
        plan_name = row[1] or "未知"
        plan_duration = row[2] or 30  # 默认30天
        product_type = row[3] or "consumer"
        plan_code = resolve_plan_code(plan_name, row[4])
        
        # 2. 检查状态
        if code_obj.status == "frozen":
            return error_response("授权码已被冻结，请联系客服", ErrorCodes.AUTH_CODE_FROZEN)
        
        if code_obj.status == "deleted":
            return error_response("授权码已被删除，请联系客服", ErrorCodes.AUTH_CODE_INVALID)
        
        if effective_license_status(code_obj) == "expired":
            return error_response("授权码已过期", ErrorCodes.AUTH_CODE_EXPIRED)
        
        # 3. 检查平台权限（1.5 新增）
        if platform_key:
            platform_scope = code_obj.platform_scope or "amazon"  # 默认亚马逊
            allowed_platforms = [p.strip() for p in platform_scope.split(",")]
            if platform_key not in allowed_platforms:
                platform_name = "亚马逊" if platform_key == "amazon" else "速卖通"
                return error_response(
                    f"当前授权码不包含{platform_name}平台权限，如需使用请升级授权",
                    ErrorCodes.AUTH_CODE_INVALID
                )
        
        # 4. 首次激活
        if code_obj.status == "unused":
            code_obj.status = "active"
            code_obj.device_id = device_id
            code_obj.device_name = device_name
            
            # Issued expiry is the commercial snapshot, including explicit
            # overrides and extensions. Never restart it from today's Plan.
            # Legacy unused codes without a term still start on activation.
            if code_obj.expires_at is None:
                code_obj.expires_at = datetime.now() + timedelta(days=plan_duration)
            
            # 创建用户记录
            user = User(
                auth_code_id=code_obj.id,
                device_id=device_id,
                device_name=device_name,
                total_seats=code_obj.seat_limit or 1,
            )
            self.db.add(user)
            await self.db.flush()
            code_obj.user_id = user.id
            logger.info("授权首次激活 auth_code_id=%s user_id=%s", code_obj.id, user.id)
        
        # 5. 席位检查（1.5 新增）
        seat_limit = code_obj.seat_limit or 1
        
        # 检查当前设备是否已有席位
        existing_seat = await self.db.execute(
            select(AuthSeat).where(
                AuthSeat.auth_code_id == code_obj.id,
                AuthSeat.device_id == device_id,
            )
        )
        matched_seat = existing_seat.scalars().first()
        seat_obj = matched_seat if matched_seat and matched_seat.status == "active" else None
        reusable_seat = matched_seat if matched_seat and matched_seat.status != "active" else None

        # Legacy clients deleted the local device ID on logout. Rebind only when the
        # retained device name identifies exactly one active seat for this auth code.
        if not seat_obj and not reusable_seat and device_name:
            legacy_seat_result = await self.db.execute(
                select(AuthSeat).where(
                    AuthSeat.auth_code_id == code_obj.id,
                    AuthSeat.device_name == device_name,
                    AuthSeat.status == "active"
                )
            )
            legacy_seats = legacy_seat_result.scalars().all()
            if len(legacy_seats) == 1:
                seat_obj = legacy_seats[0]
                legacy_device_id = seat_obj.device_id
                seat_obj.device_id = device_id
                seat_obj.device_name = device_name

                if legacy_device_id:
                    legacy_devices_result = await self.db.execute(
                        select(Device).where(
                            Device.auth_code_id == code_obj.id,
                            Device.device_id == legacy_device_id
                        )
                    )
                    for legacy_device in legacy_devices_result.scalars().all():
                        legacy_device.device_id = device_id
                        legacy_device.device_name = device_name

                    if code_obj.device_id == legacy_device_id:
                        code_obj.device_id = device_id
                        code_obj.device_name = device_name

                    if code_obj.user_id:
                        legacy_user_result = await self.db.execute(
                            select(User).where(User.id == code_obj.user_id)
                        )
                        legacy_user = legacy_user_result.scalars().first()
                        if legacy_user and legacy_user.device_id == legacy_device_id:
                            legacy_user.device_id = device_id
                            legacy_user.device_name = device_name

                logger.info(
                    "授权恢复同一设备席位 auth_code_id=%s seat_id=%s",
                    code_obj.id, seat_obj.id,
                )
        
        # 缓存席位计数，后续响应直接复用
        if not seat_obj:
            # 检查席位数是否已满
            active_seats_count = await self.db.execute(
                select(func.count(AuthSeat.id)).where(
                    AuthSeat.auth_code_id == code_obj.id,
                    AuthSeat.status == "active"
                )
            )
            active_seats = active_seats_count.scalar() or 0
            
            if active_seats >= seat_limit:
                return error_response(
                    f"该授权码席位数已满({seat_limit}席)，请联系管理员升级",
                    ErrorCodes.DEVICE_LIMIT_EXCEEDED
                )
            
            # 解绑只释放席位而不删除历史记录。相同设备再次登录时复用
            # 原席位，既保留审计历史，也避免与组合唯一约束冲突。
            if reusable_seat:
                seat_obj = reusable_seat
                seat_obj.user_id = code_obj.user_id
                seat_obj.device_name = device_name
                seat_obj.status = "active"
                seat_obj.updated_at = datetime.utcnow()
            else:
                seat_obj = AuthSeat(
                    auth_code_id=code_obj.id,
                    user_id=code_obj.user_id,
                    device_id=device_id,
                    device_name=device_name,
                    seat_no=active_seats + 1,
                    status="active"
                )
                self.db.add(seat_obj)
            await self.db.flush()
            
            # P2: 并发安全 - 创建后二次检查席位数
            recheck_count = await self.db.execute(
                select(func.count(AuthSeat.id)).where(
                    AuthSeat.auth_code_id == code_obj.id,
                    AuthSeat.status == "active"
                )
            )
            recheck_seats = recheck_count.scalar() or 0
            if recheck_seats > seat_limit:
                # 超限，回滚当前席位
                seat_obj.status = "inactive"
                await self.db.flush()
                return error_response(
                    f"该授权码席位数已满({seat_limit}席)，请联系管理员升级",
                    ErrorCodes.DEVICE_LIMIT_EXCEEDED
                )
            
            active_seats = recheck_seats
            logger.info("授权绑定席位 auth_code_id=%s seat_id=%s", code_obj.id, seat_obj.id)
        else:
            # 已有席位，获取当前席位数
            active_seats_count = await self.db.execute(
                select(func.count(AuthSeat.id)).where(
                    AuthSeat.auth_code_id == code_obj.id,
                    AuthSeat.status == "active"
                )
            )
            active_seats = active_seats_count.scalar() or 0
        
        # 6. 多设备支持
        existing_device = await self.db.execute(
            select(Device).where(
                Device.auth_code_id == code_obj.id,
                Device.device_id == device_id
            )
        )
        device_obj = existing_device.scalars().first()
        
        # 缓存设备计数，后续响应直接复用
        if not device_obj:
            # 检查设备上限
            device_count_result = await self.db.execute(
                select(func.count(Device.id)).where(Device.auth_code_id == code_obj.id)
            )
            device_count = device_count_result.scalar() or 0
            
            if device_count >= (code_obj.max_devices or 1):
                return error_response(
                    f"该授权码已达设备上限({code_obj.max_devices}台)，请联系管理员",
                    ErrorCodes.DEVICE_LIMIT_EXCEEDED
                )
            
            # 绑定新设备
            device_obj = Device(
                auth_code_id=code_obj.id,
                device_id=device_id,
                device_name=device_name
            )
            self.db.add(device_obj)
            await self.db.flush()
            device_count += 1  # 新增了一个设备
            logger.info("授权绑定设备 auth_code_id=%s device_record_id=%s", code_obj.id, device_obj.id)
        else:
            # 已有设备，获取当前设备数
            device_count_result = await self.db.execute(
                select(func.count(Device.id)).where(Device.auth_code_id == code_obj.id)
            )
            device_count = device_count_result.scalar() or 0
        
        # 7. 提交事务
        auth_code_id = code_obj.id
        try:
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            # SQL exceptions can contain bound credentials; keep diagnostic
            # identity/type without serializing the exception's parameter text.
            logger.error("授权验证事务失败 auth_code_id=%s error_type=%s", auth_code_id, type(e).__name__)
            return error_response("验证过程出错，请重试", ErrorCodes.DATABASE_ERROR)
        
        # 8. 生成 JWT Token（plan_name 和统计数据已在上方缓存，无需重复查询）
        token = create_access_token(data={
            "user_id": code_obj.user_id,
            "role": "user",
            "auth_code_id": code_obj.id,
            "device_id": device_id,
        })
        
        # 解析平台权限
        platform_scope = code_obj.platform_scope or "amazon"
        platform_list = [p.strip() for p in platform_scope.split(",")]
        
        access = await resolve_product_access(self.db, code_obj.id)
        plan_name = access.get("plan_name", plan_name)
        plan_code = access["entitlements"].get("plan_code", plan_code)
        product_type = access["product_type"]
        return success_response(
            data={
                "token": token,
                "user_id": code_obj.user_id,
                "code": code_obj.code,
                "plan_name": plan_name,
                "plan_code": plan_code,
                "expires_at": code_obj.expires_at.isoformat() if code_obj.expires_at else None,
                "device_id": code_obj.device_id,
                # 1.5 新增字段
                "platform_scope": platform_list,
                "scene_type": code_obj.scene_type,
                "seat_limit": seat_limit,
                "seat_used": active_seats,
                "max_devices": code_obj.max_devices or 1,
                "device_used": device_count,
                "product_type": product_type,
                "entitlements": access["entitlements"],
                "business_workspace_enabled": access["enabled"],
            },
            message="验证成功"
        )
    
    async def admin_login(
        self,
        password: str,
        username: str = "admin",
        request: Request | None = None,
    ) -> dict[str, Any]:
        """Compatibility login URL backed exclusively by ``staff_users``."""
        staff = await authenticate_staff(self.db, username, password, request=request)
        if staff:
            logger.info("后台账号兼容入口登录成功: %s", staff.username)
            return success_response(
                data={"token": create_staff_access_token(staff), **staff_to_dict(staff)},
                message="登录成功",
            )
        logger.warning("后台账号兼容入口登录失败: %s", username)
        return error_response("密码错误", ErrorCodes.UNAUTHORIZED)
    
    async def check_auth_status(self, auth_code_id: int | None) -> dict[str, Any]:
        """检查授权码状态（用于踢人检测）"""
        if not auth_code_id:
            return success_response(data={"role": "admin"}, message="管理员")
        
        result = await self.db.execute(
            select(AuthCode).where(AuthCode.id == auth_code_id)
        )
        code_obj = result.scalars().first()
        
        if not code_obj:
            return error_response("授权码无效，请重新登录", ErrorCodes.AUTH_CODE_INVALID)
        
        if code_obj.status == "frozen":
            return error_response("您的授权码已被冻结，请联系客服", ErrorCodes.AUTH_CODE_FROZEN)
        
        if effective_license_status(code_obj) == "expired":
            return error_response("您的授权码已过期，请续费", ErrorCodes.AUTH_CODE_EXPIRED)
        
        if code_obj.status == "deleted":
            return error_response("您的授权码已被删除，请联系客服", ErrorCodes.AUTH_CODE_INVALID)
        
        # 获取套餐名称
        plan_name = "未知"
        product_type = "consumer"
        entitlements = {}
        business_workspace_enabled = False
        if code_obj.plan_id:
            plan_result = await self.db.execute(
                select(Plan.name).where(Plan.id == code_obj.plan_id)
            )
            plan_name = plan_result.scalar() or "未知"
        access = await resolve_product_access(self.db, code_obj.id)
        plan_name = access.get("plan_name", plan_name)
        product_type = access["product_type"]
        entitlements = access["entitlements"]
        business_workspace_enabled = access["enabled"]

        active_seats = len([seat for seat in (code_obj.seats or []) if seat.status == "active"])
        device_used = len(code_obj.devices or [])
        
        return success_response(
            data={
                "role": "user",
                "plan_name": plan_name,
                "expires_at": code_obj.expires_at.isoformat() if code_obj.expires_at else None,
                "plan_code": entitlements.get("plan_code"),
                "product_type": product_type,
                "entitlements": entitlements,
                "business_workspace_enabled": business_workspace_enabled,
                "seat_limit": code_obj.seat_limit or 1,
                "seat_used": active_seats,
                "max_devices": code_obj.max_devices or 1,
                "device_used": device_used,
            },
            message="正常"
        )
    
    async def get_user_info(self, user_id: int, auth_code_id: int | None, role: str) -> dict[str, Any]:
        """获取当前用户信息"""
        if role == "admin":
            return success_response(data={
                "user_id": 0,
                "role": "admin",
                "name": "管理员",
            })
        
        # 查询用户信息
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalars().first()
        
        if not user:
            return error_response("用户不存在", ErrorCodes.RESOURCE_NOT_FOUND)
        
        # 查询授权码信息
        plan_name = "未知"
        expires_at = None
        product_type = "consumer"
        entitlements = normalize_entitlements({}, "consumer")
        business_workspace_enabled = False
        if auth_code_id:
            auth_code_result = await self.db.execute(
                select(AuthCode).where(AuthCode.id == auth_code_id)
            )
            auth_code = auth_code_result.scalars().first()
            
            if auth_code:
                if auth_code.plan_id:
                    plan_result = await self.db.execute(
                        select(Plan.name, Plan.product_type, Plan.entitlements).where(Plan.id == auth_code.plan_id)
                    )
                    plan_row = plan_result.first()
                    if plan_row:
                        plan_name = plan_row[0] or "未知"
                        product_type = plan_row[1] or "consumer"
                expires_at = auth_code.expires_at.isoformat() if auth_code.expires_at else None
                access = await resolve_product_access(self.db, auth_code.id)
                plan_name = access.get("plan_name", plan_name)
                product_type = access["product_type"]
                entitlements = access["entitlements"]
                business_workspace_enabled = access["enabled"]
        
        return success_response(data={
            "user_id": user.id,
            "role": "user",
            "name": user.name or user.device_name or "用户",
            "device_id": user.device_id,
            "device_name": user.device_name,
            "plan_name": plan_name,
            "plan_code": entitlements.get("plan_code"),
            "expires_at": expires_at,
            "product_type": product_type,
            "entitlements": entitlements,
            "business_workspace_enabled": business_workspace_enabled,
        })
    
    async def refresh_token(self, user_id: int, role: str, auth_code_id: int | None, device_id: str | None = None) -> dict[str, Any]:
        """刷新 Token"""
        new_token = create_access_token(data={
            "user_id": user_id,
            "role": role,
            "auth_code_id": auth_code_id,
            "device_id": device_id,
        })
        
        return success_response(data={"token": new_token})
