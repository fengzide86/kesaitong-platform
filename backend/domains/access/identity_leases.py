"""Portable account-lease and auth-session services.

The service deliberately accepts an external account *reference* only to
derive a one-way identity key.  The raw reference, credentials, cookies, MFA
codes and JWTs are never persisted or logged.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_admin_action
from models.identity import (
    AuthSession,
    AuthSessionStatus,
    ExternalAccountBinding,
    ExternalAccountLease,
    ExternalBindingStatus,
    ExternalLeaseStatus,
)


class IdentityLeaseError(Exception):
    """Base error for account identity lease operations."""


class IdentityLeaseConflict(IdentityLeaseError):
    def __init__(self, *, site_origin: str, identity_hint: str, lease_id: int | None = None) -> None:
        super().__init__("该平台账号已经在其他现场使用，请先结束原现场")
        self.site_origin = site_origin
        self.identity_hint = identity_hint
        self.lease_id = lease_id


class IdentityLeaseNotFound(IdentityLeaseError):
    pass


class IdentityLeaseNeedsRelogin(IdentityLeaseError):
    pass


class AuthSessionConflict(IdentityLeaseError):
    def __init__(self, *, principal_id: int, device_id: str, session_id: str | None = None) -> None:
        super().__init__("该授权已经在其他设备登录，请先退出原设备")
        self.principal_id = principal_id
        self.device_id = device_id
        self.session_id = session_id


class AuthSessionNotFound(IdentityLeaseError):
    pass


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _normalize_ref(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("外部账号标识无效")
    normalized = " ".join(value.strip().casefold().split())
    if not normalized or len(normalized) > 200:
        raise ValueError("外部账号标识无效")
    return normalized


def _canonical_origin(value: str) -> str:
    # Import lazily: ``schemas.scenario`` imports automation contracts, and
    # eagerly importing it from ``domains.access`` would create a catalog
    # initialization cycle during app startup.
    from schemas.scenario import exact_origin

    return exact_origin(value)


def external_account_ref_hash(site_origin: str, external_account_ref: str) -> str:
    """Return a stable, non-reversible identity key for one site/account pair."""

    origin = _canonical_origin(site_origin)
    value = f"{origin}\x00{_normalize_ref(external_account_ref)}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _lease_hint(value: str) -> str:
    return f"{value[:12]}…"


def lease_dict(row: ExternalAccountLease, *, lease_token: str | None = None) -> dict[str, Any]:
    """Safe response shape; never include the raw external account reference."""

    result: dict[str, Any] = {
        "id": row.id,
        "owner_kind": row.owner_kind,
        "owner_id": row.owner_id,
        "workspace_id": row.workspace_id,
        "account_slot": row.account_slot,
        "scene_id": row.scene_id,
        "site_origin": row.site_origin,
        "external_account_hint": _lease_hint(row.external_account_ref_hash),
        "status": row.status,
        "revision": row.revision,
        "last_heartbeat_at": row.last_heartbeat_at.isoformat() + "Z",
        "expires_at": row.expires_at.isoformat() + "Z",
    }
    if lease_token is not None:
        result["lease_token"] = lease_token
    return result


def session_dict(row: AuthSession, *, session_token: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": row.id,
        "session_id": row.session_id,
        "principal_kind": row.principal_kind,
        "principal_id": row.principal_id,
        "auth_code_id": row.auth_code_id,
        "device_id": row.device_id,
        "status": row.status,
        "last_seen_at": row.last_seen_at.isoformat() + "Z",
        "expires_at": row.expires_at.isoformat() + "Z",
    }
    if session_token is not None:
        result["session_token"] = session_token
    return result


async def acquire_identity_lease(
    db: AsyncSession,
    *,
    owner_kind: str,
    owner_id: int,
    auth_code_id: int | None,
    device_id: str,
    workspace_id: str,
    account_slot: str,
    scene_id: str,
    site_origin: str,
    external_account_ref: str,
    takeover: bool = False,
    takeover_actor_id: int | None = None,
    ttl_seconds: int = 90,
) -> dict[str, Any]:
    """Acquire one account identity, failing closed on a held lease.

    ``takeover`` is intentionally restricted to staff callers.  A customer
    cannot evict another device/session by sending a request flag.
    """

    if owner_kind not in {"user", "staff"}:
        raise ValueError("owner_kind 无效")
    if not device_id or not workspace_id or not account_slot or not scene_id:
        raise ValueError("现场标识不完整")
    if owner_kind == "user" and takeover:
        raise IdentityLeaseConflict(site_origin=site_origin, identity_hint="unknown")
    if owner_kind == "user" and auth_code_id is None:
        raise ValueError("客户现场必须绑定授权码")
    if owner_kind == "staff" and auth_code_id is not None:
        raise ValueError("管理员现场不能借用客户授权码")
    if takeover and (owner_kind != "staff" or not takeover_actor_id):
        raise ValueError("接管只能由已验证的管理员发起")

    origin = _canonical_origin(site_origin)
    identity_hash = external_account_ref_hash(origin, external_account_ref)
    now = utc_now()
    expiry = now + timedelta(seconds=max(30, min(ttl_seconds, 300)))

    binding = None
    if owner_kind == "user":
        binding = (
            await db.execute(
                select(ExternalAccountBinding)
                .where(
                    ExternalAccountBinding.auth_code_id == auth_code_id,
                    ExternalAccountBinding.site_origin == origin,
                    ExternalAccountBinding.active_guard == "held",
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if binding is not None and binding.external_account_ref_hash != identity_hash:
            binding_hint = _lease_hint(binding.external_account_ref_hash)
            binding_id = binding.id
            await db.rollback()
            raise IdentityLeaseConflict(
                site_origin=origin,
                identity_hint=binding_hint,
                lease_id=binding_id,
            )
        if binding is None:
            binding = ExternalAccountBinding(
                auth_code_id=auth_code_id,
                site_origin=origin,
                external_account_ref_hash=identity_hash,
                status=ExternalBindingStatus.ACTIVE,
                active_guard="held",
                bound_by_kind="user",
                bound_by_id=owner_id,
                revision=1,
            )
            db.add(binding)
            await db.flush()
    existing = (
        await db.execute(
            select(ExternalAccountLease)
            .where(
                ExternalAccountLease.site_origin == origin,
                ExternalAccountLease.external_account_ref_hash == identity_hash,
                ExternalAccountLease.active_guard == "held",
            )
            .with_for_update()
        )
    ).scalar_one_or_none()

    # A customer authorization is bound to one external account per platform.
    # This is separate from the global identity guard: it also rejects the
    # same customer switching to a different account.  Staff leases do not
    # borrow customer authorization and therefore do not use this guard.
    binding_existing = None
    if owner_kind == "user":
        binding_existing = (
            await db.execute(
                select(ExternalAccountLease)
                .where(
                    ExternalAccountLease.auth_code_id == auth_code_id,
                    ExternalAccountLease.site_origin == origin,
                    ExternalAccountLease.auth_binding_guard == "held",
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if binding_existing is not None and binding_existing.expires_at <= now:
            binding_existing.status = ExternalLeaseStatus.EXPIRED
            binding_existing.active_guard = None
            binding_existing.auth_binding_guard = None
            binding_existing.released_at = now
            binding_existing.release_reason = "heartbeat_timeout"
            await db.flush()
            binding_existing = None
        elif binding_existing is not None and binding_existing.external_account_ref_hash != identity_hash:
            binding_hint = _lease_hint(binding_existing.external_account_ref_hash)
            binding_id = binding_existing.id
            await db.rollback()
            raise IdentityLeaseConflict(
                site_origin=origin,
                identity_hint=binding_hint,
                lease_id=binding_id,
            )
    if existing is not None:
        if existing.expires_at <= now:
            existing.status = ExternalLeaseStatus.EXPIRED
            existing.active_guard = None
            existing.released_at = now
            existing.release_reason = "heartbeat_timeout"
            await db.flush()
        elif not takeover:
            # Reconnecting the exact same controlled scene is safe (for
            # example after the login observer sees the post-login route).
            # A second scene, device, slot, or owner must still fail closed;
            # this is the server-side guard behind the customer anti-sharing
            # rule and the admin no-duplicate-account rule.
            same_scene = (
                existing.owner_kind == owner_kind
                and existing.owner_id == owner_id
                and existing.device_id == device_id
                and existing.workspace_id == workspace_id
                and existing.account_slot == account_slot
                and existing.scene_id == scene_id
            )
            if not same_scene:
                existing_id = existing.id
                await db.rollback()
                raise IdentityLeaseConflict(
                    site_origin=origin,
                    identity_hint=_lease_hint(identity_hash),
                    lease_id=existing_id,
                )
            lease_token = "lease." + secrets.token_urlsafe(32)
            existing.lease_token_hash = _token_hash(lease_token)
            existing.status = ExternalLeaseStatus.ACTIVE
            existing.last_heartbeat_at = now
            existing.expires_at = expiry
            existing.revision += 1
            await db.commit()
            await db.refresh(existing)
            return lease_dict(existing, lease_token=lease_token)
        else:
            previous_id = existing.id
            existing.status = ExternalLeaseStatus.RELEASED
            existing.active_guard = None
            existing.auth_binding_guard = None
            existing.released_at = now
            existing.release_reason = "staff_takeover"
            existing.revision += 1
            await db.flush()
            await log_admin_action(
                db,
                user_id=takeover_actor_id,
                action="external_account_lease.takeover",
                target_type="external_account_lease",
                target_id=previous_id,
                detail={"site_origin": origin, "identity_hint": _lease_hint(identity_hash)},
            )

    lease_token = "lease." + secrets.token_urlsafe(32)
    row = ExternalAccountLease(
        owner_kind=owner_kind,
        owner_id=owner_id,
        auth_code_id=auth_code_id,
        device_id=device_id,
        workspace_id=workspace_id,
        account_slot=account_slot,
        scene_id=scene_id,
        site_origin=origin,
        external_account_ref_hash=identity_hash,
        auth_binding_guard="held" if owner_kind == "user" else None,
        binding_id=binding.id if binding is not None else None,
        lease_token_hash=_token_hash(lease_token),
        status=ExternalLeaseStatus.ACTIVE,
        active_guard="held",
        revision=1,
        last_heartbeat_at=now,
        expires_at=expiry,
    )
    if existing is not None and existing.status == ExternalLeaseStatus.RELEASED:
        row.takeover_of_id = existing.id
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise IdentityLeaseConflict(
            site_origin=origin,
            identity_hint=_lease_hint(identity_hash),
        ) from exc
    await db.refresh(row)
    return lease_dict(row, lease_token=lease_token)


async def heartbeat_identity_lease(
    db: AsyncSession,
    *,
    lease_id: int,
    lease_token: str,
    ttl_seconds: int = 90,
) -> dict[str, Any]:
    row = (
        await db.execute(
            select(ExternalAccountLease)
            .where(ExternalAccountLease.id == lease_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.lease_token_hash != _token_hash(lease_token):
        raise IdentityLeaseNotFound("账号现场不存在或令牌无效")
    now = utc_now()
    if row.status == ExternalLeaseStatus.NEEDS_RELOGIN:
        raise IdentityLeaseNeedsRelogin("外部网站登录已失效，请人工重新登录后恢复现场")
    if row.active_guard != "held" or row.status not in ExternalLeaseStatus.HELD or row.expires_at <= now:
        raise IdentityLeaseNotFound("账号现场已结束，请重新打开")
    row.last_heartbeat_at = now
    row.expires_at = now + timedelta(seconds=max(30, min(ttl_seconds, 300)))
    row.revision += 1
    await db.commit()
    await db.refresh(row)
    return lease_dict(row)


async def takeover_customer_binding(
    db: AsyncSession,
    *,
    staff_id: int,
    auth_code_id: int,
    site_origin: str,
    external_account_ref: str,
    reason: str = "staff_takeover",
) -> dict[str, Any]:
    """Replace a customer's platform binding with an explicit staff action.

    This does not open a browser or grant tool execution; it only changes the
    durable account binding.  The previous binding is retained as revoked
    history and the action is written to the admin audit log.
    """

    origin = _canonical_origin(site_origin)
    identity_hash = external_account_ref_hash(origin, external_account_ref)
    now = utc_now()
    existing = (
        await db.execute(
            select(ExternalAccountBinding)
            .where(
                ExternalAccountBinding.auth_code_id == auth_code_id,
                ExternalAccountBinding.site_origin == origin,
                ExternalAccountBinding.active_guard == "held",
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing is not None and existing.external_account_ref_hash == identity_hash:
        return {
            "binding_id": existing.id,
            "auth_code_id": auth_code_id,
            "site_origin": origin,
            "external_account_hint": _lease_hint(identity_hash),
            "status": existing.status,
            "replaced_binding_id": None,
        }
    previous_id = existing.id if existing is not None else None
    if existing is not None:
        existing.status = ExternalBindingStatus.REVOKED
        existing.active_guard = None
        existing.revoked_at = now
        existing.revoked_by_staff_id = staff_id
        existing.revoke_reason = reason[:200]
        existing.revision += 1
        old_leases = list(
            (
                await db.execute(
                    select(ExternalAccountLease)
                    .where(
                        ExternalAccountLease.binding_id == existing.id,
                        ExternalAccountLease.active_guard == "held",
                    )
                    .with_for_update()
                )
            ).scalars()
        )
        for lease in old_leases:
            lease.status = ExternalLeaseStatus.RELEASED
            lease.active_guard = None
            lease.auth_binding_guard = None
            lease.released_at = now
            lease.release_reason = "binding_takeover"
            lease.revision += 1
        await db.flush()
    row = ExternalAccountBinding(
        auth_code_id=auth_code_id,
        site_origin=origin,
        external_account_ref_hash=identity_hash,
        status=ExternalBindingStatus.ACTIVE,
        active_guard="held",
        bound_by_kind="staff",
        bound_by_id=staff_id,
        revision=1,
    )
    db.add(row)
    try:
        await db.flush()
        await log_admin_action(
            db,
            user_id=staff_id,
            action="external_account_binding.takeover",
            target_type="auth_code",
            target_id=auth_code_id,
            detail={
                "site_origin": origin,
                "external_account_hint": _lease_hint(identity_hash),
                "replaced_binding_id": previous_id,
                "reason": reason[:200],
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise IdentityLeaseConflict(site_origin=origin, identity_hint=_lease_hint(identity_hash)) from exc
    await db.refresh(row)
    return {
        "binding_id": row.id,
        "auth_code_id": auth_code_id,
        "site_origin": origin,
        "external_account_hint": _lease_hint(identity_hash),
        "status": row.status,
        "replaced_binding_id": previous_id,
    }


async def mark_identity_needs_relogin(db: AsyncSession, lease_id: int, *, reason: str = "login_required") -> dict[str, Any]:
    row = (
        await db.execute(select(ExternalAccountLease).where(ExternalAccountLease.id == lease_id).with_for_update())
    ).scalar_one_or_none()
    if row is None or row.active_guard != "held":
        raise IdentityLeaseNotFound("账号现场不存在")
    row.status = ExternalLeaseStatus.NEEDS_RELOGIN
    row.revision += 1
    row.release_reason = reason[:200]
    await db.commit()
    await db.refresh(row)
    return lease_dict(row)


async def release_identity_lease(db: AsyncSession, *, lease_id: int, lease_token: str, reason: str = "released") -> None:
    row = (
        await db.execute(select(ExternalAccountLease).where(ExternalAccountLease.id == lease_id).with_for_update())
    ).scalar_one_or_none()
    if row is None or row.lease_token_hash != _token_hash(lease_token):
        raise IdentityLeaseNotFound("账号现场不存在或令牌无效")
    now = utc_now()
    row.status = ExternalLeaseStatus.RELEASED
    row.active_guard = None
    # The durable ExternalAccountBinding remains active (so a customer cannot
    # switch to another platform account), but this ephemeral lease guard must
    # be cleared so the same bound account can be reopened later.
    row.auth_binding_guard = None
    row.released_at = now
    row.release_reason = reason[:200]
    row.revision += 1
    await db.commit()


async def list_identity_leases(db: AsyncSession, *, owner_kind: str | None = None, owner_id: int | None = None) -> list[dict[str, Any]]:
    query = select(ExternalAccountLease).order_by(ExternalAccountLease.updated_at.desc(), ExternalAccountLease.id.desc())
    if owner_kind is not None:
        query = query.where(ExternalAccountLease.owner_kind == owner_kind)
    if owner_id is not None:
        query = query.where(ExternalAccountLease.owner_id == owner_id)
    rows = (await db.execute(query.limit(100))).scalars().all()
    return [lease_dict(row) for row in rows]


async def create_auth_session(
    db: AsyncSession,
    *,
    principal_kind: str,
    principal_id: int,
    auth_code_id: int | None,
    device_id: str,
    ttl_seconds: int = 3600,
    replace_existing: bool = False,
    commit: bool = True,
) -> dict[str, Any]:
    """Create a one-device session; refuse a second device by default."""

    if principal_kind not in {"user", "staff"}:
        raise ValueError("principal_kind 无效")
    if principal_kind == "user" and auth_code_id is None:
        raise ValueError("客户会话必须绑定授权码")
    if principal_kind == "staff" and auth_code_id is not None:
        raise ValueError("管理员会话不能绑定客户授权码")
    if not device_id:
        raise ValueError("设备标识不能为空")
    now = utc_now()
    active = (
        await db.execute(
            select(AuthSession)
            .where(
                AuthSession.principal_kind == principal_kind,
                AuthSession.principal_id == principal_id,
                AuthSession.active_guard == "held",
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if active is not None and active.expires_at <= now:
        active.status = AuthSessionStatus.EXPIRED
        active.active_guard = None
        await db.flush()
    # Re-authentication on the same device is safe and replaces the old
    # server session. A different device remains blocked unless an explicit
    # staff-only replacement flow opts in with ``replace_existing``.
    elif active is not None and active.device_id == device_id:
        active.status = AuthSessionStatus.REVOKED
        active.active_guard = None
        active.revoked_at = now
        active.revoke_reason = "replaced_by_same_device_login"
        await db.flush()
    elif active is not None and not replace_existing:
        active_session_id = active.session_id
        await db.rollback()
        raise AuthSessionConflict(principal_id=principal_id, device_id=device_id, session_id=active_session_id)
    elif active is not None:
        active.status = AuthSessionStatus.REVOKED
        active.active_guard = None
        active.revoked_at = now
        active.revoke_reason = "replaced_by_new_login"
        await db.flush()

    session_token = "session." + secrets.token_urlsafe(32)
    row = AuthSession(
        session_id=str(uuid.uuid4()),
        session_token_hash=_token_hash(session_token),
        principal_kind=principal_kind,
        principal_id=principal_id,
        auth_code_id=auth_code_id,
        device_id=device_id,
        status=AuthSessionStatus.ACTIVE,
        active_guard="held",
        last_seen_at=now,
        expires_at=now + timedelta(seconds=max(60, min(ttl_seconds, 86400))),
    )
    db.add(row)
    try:
        await db.flush()
        if commit:
            await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise AuthSessionConflict(principal_id=principal_id, device_id=device_id) from exc
    if commit:
        await db.refresh(row)
    return session_dict(row, session_token=session_token)


async def validate_auth_session(
    db: AsyncSession,
    *,
    session_id: str,
    session_token: str,
    touch: bool = True,
) -> dict[str, Any]:
    row = (
        await db.execute(select(AuthSession).where(AuthSession.session_id == session_id).with_for_update())
    ).scalar_one_or_none()
    if row is None or row.session_token_hash != _token_hash(session_token):
        raise AuthSessionNotFound("登录会话无效")
    now = utc_now()
    if row.status != AuthSessionStatus.ACTIVE or row.active_guard != "held" or row.expires_at <= now:
        if row.status == AuthSessionStatus.ACTIVE and row.expires_at <= now:
            row.status = AuthSessionStatus.EXPIRED
            row.active_guard = None
            await db.commit()
        raise AuthSessionNotFound("登录会话已失效，请重新登录")
    if touch:
        row.last_seen_at = now
        await db.commit()
        await db.refresh(row)
    return session_dict(row)


async def revoke_auth_session(db: AsyncSession, *, session_id: str, reason: str = "logout") -> None:
    row = (await db.execute(select(AuthSession).where(AuthSession.session_id == session_id).with_for_update())).scalar_one_or_none()
    if row is None:
        return
    row.status = AuthSessionStatus.REVOKED
    row.active_guard = None
    row.revoked_at = utc_now()
    row.revoke_reason = reason[:200]
    await db.commit()


async def revoke_principal_sessions(db: AsyncSession, *, principal_kind: str, principal_id: int, reason: str = "admin_revoked") -> int:
    now = utc_now()
    rows = list((await db.execute(select(AuthSession).where(
        AuthSession.principal_kind == principal_kind,
        AuthSession.principal_id == principal_id,
        AuthSession.active_guard == "held",
    ).with_for_update())).scalars())
    for row in rows:
        row.status = AuthSessionStatus.REVOKED
        row.active_guard = None
        row.revoked_at = now
        row.revoke_reason = reason[:200]
    if rows:
        await db.commit()
    return len(rows)
