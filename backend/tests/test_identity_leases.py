"""Security regressions for external account bindings and auth sessions."""

import pytest
from sqlalchemy import select

from domains.access.identity_leases import (
    AuthSessionConflict,
    IdentityLeaseConflict,
    acquire_identity_lease,
    create_auth_session,
    external_account_ref_hash,
    release_identity_lease,
    revoke_principal_sessions,
    takeover_customer_binding,
)
from models import AuditLog, AuthCode, ExternalAccountBinding, ExternalAccountLease

pytestmark = pytest.mark.asyncio


async def _auth_code(db_session, code: str) -> AuthCode:
    row = AuthCode(code=code, status="active")
    db_session.add(row)
    await db_session.commit()
    return row


async def test_external_identity_is_hashed_and_never_returned():
    digest = external_account_ref_hash("https://EXAMPLE.test:443/path", "  Account A ")
    assert len(digest) == 64
    assert "account" not in digest.lower()


@pytest.mark.parametrize("value", [None, "   "])
async def test_external_identity_rejects_missing_reference(value):
    with pytest.raises(ValueError, match="外部账号标识无效"):
        external_account_ref_hash("https://seller.example", value)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"owner_kind": "unknown"}, "owner_kind 无效"),
        ({"device_id": ""}, "现场标识不完整"),
        ({"owner_kind": "user", "takeover": True}, ""),
        ({"owner_kind": "user", "auth_code_id": None}, "客户现场必须绑定授权码"),
        ({"owner_kind": "staff", "auth_code_id": 1}, "管理员现场不能借用客户授权码"),
        ({"takeover": True, "owner_kind": "staff", "auth_code_id": None, "takeover_actor_id": None}, "接管只能由已验证的管理员发起"),
    ],
)
async def test_lease_validation_rejects_unsafe_inputs(db_session, overrides, message):
    args = {
        "owner_kind": "user",
        "owner_id": 1,
        "auth_code_id": 1,
        "device_id": "device-1",
        "workspace_id": "customer",
        "account_slot": "single",
        "scene_id": "scene-1",
        "site_origin": "https://seller.example",
        "external_account_ref": "account-a",
    }
    args.update(overrides)
    with pytest.raises((ValueError, IdentityLeaseConflict), match=message or None):
        await acquire_identity_lease(db_session, **args)


async def test_customer_binding_rejects_switching_account_even_after_lease_release(db_session):
    code = await _auth_code(db_session, "bind-1")
    code_id = code.id
    first = await acquire_identity_lease(
        db_session,
        owner_kind="user",
        owner_id=101,
        auth_code_id=code_id,
        device_id="device-1",
        workspace_id="customer",
        account_slot="single",
        scene_id="scene-1",
        site_origin="https://seller.example",
        external_account_ref="seller-account-a",
    )
    assert first["lease_token"] and "seller-account-a" not in str(first)
    with pytest.raises(IdentityLeaseConflict):
        await acquire_identity_lease(
            db_session,
            owner_kind="user",
            owner_id=101,
            auth_code_id=code_id,
            device_id="device-1",
            workspace_id="customer",
            account_slot="single",
            scene_id="scene-2",
            site_origin="https://seller.example",
            external_account_ref="seller-account-b",
        )
    await release_identity_lease(db_session, lease_id=first["id"], lease_token=first["lease_token"])
    with pytest.raises(IdentityLeaseConflict):
        await acquire_identity_lease(
            db_session,
            owner_kind="user",
            owner_id=101,
            auth_code_id=code_id,
            device_id="device-1",
            workspace_id="customer",
            account_slot="single",
            scene_id="scene-3",
            site_origin="https://seller.example",
            external_account_ref="seller-account-b",
        )
    assert (await db_session.scalar(select(ExternalAccountBinding))).external_account_ref_hash == external_account_ref_hash(
        "https://seller.example", "seller-account-a"
    )


async def test_customer_can_reopen_the_same_bound_account_after_release(db_session):
    code = await _auth_code(db_session, "bind-reopen")
    first = await acquire_identity_lease(
        db_session,
        owner_kind="user",
        owner_id=101,
        auth_code_id=code.id,
        device_id="device-1",
        workspace_id="customer",
        account_slot="single",
        scene_id="scene-1",
        site_origin="https://seller.example",
        external_account_ref="seller-account-a",
    )
    await release_identity_lease(db_session, lease_id=first["id"], lease_token=first["lease_token"])
    reopened = await acquire_identity_lease(
        db_session,
        owner_kind="user",
        owner_id=101,
        auth_code_id=code.id,
        device_id="device-1",
        workspace_id="customer",
        account_slot="single",
        scene_id="scene-2",
        site_origin="https://seller.example",
        external_account_ref="seller-account-a",
    )
    assert reopened["id"] != first["id"]


async def test_same_external_account_cannot_be_held_by_two_customers(db_session):
    code_a = await _auth_code(db_session, "bind-a")
    code_b = await _auth_code(db_session, "bind-b")
    args = dict(
        device_id="device-1",
        workspace_id="customer",
        account_slot="single",
        scene_id="scene-1",
        site_origin="https://seller.example",
        external_account_ref="shared-account",
    )
    await acquire_identity_lease(db_session, owner_kind="user", owner_id=1, auth_code_id=code_a.id, **args)
    with pytest.raises(IdentityLeaseConflict):
        await acquire_identity_lease(db_session, owner_kind="user", owner_id=2, auth_code_id=code_b.id, **args)


async def test_staff_takeover_revokes_old_binding_and_records_audit(db_session):
    code = await _auth_code(db_session, "bind-takeover")
    old = await acquire_identity_lease(
        db_session,
        owner_kind="user",
        owner_id=7,
        auth_code_id=code.id,
        device_id="device-1",
        workspace_id="customer",
        account_slot="single",
        scene_id="scene-1",
        site_origin="https://seller.example",
        external_account_ref="old-account",
    )
    replaced = await takeover_customer_binding(
        db_session,
        staff_id=99,
        auth_code_id=code.id,
        site_origin="https://seller.example",
        external_account_ref="new-account",
        reason="customer requested account change",
    )
    assert replaced["replaced_binding_id"] is not None
    old_row = await db_session.get(ExternalAccountLease, old["id"])
    assert old_row.status == "released" and old_row.active_guard is None
    assert (await db_session.scalar(select(AuditLog).where(AuditLog.action == "external_account_binding.takeover"))) is not None


async def test_auth_session_rejects_second_device_until_old_session_revoked(db_session):
    first = await create_auth_session(
        db_session,
        principal_kind="user",
        principal_id=77,
        auth_code_id=7,
        device_id="device-a",
        ttl_seconds=300,
    )
    with pytest.raises(AuthSessionConflict):
        await create_auth_session(
            db_session,
            principal_kind="user",
            principal_id=77,
            auth_code_id=7,
            device_id="device-b",
        )
    assert await revoke_principal_sessions(db_session, principal_kind="user", principal_id=77) == 1
    second = await create_auth_session(
        db_session,
        principal_kind="user",
        principal_id=77,
        auth_code_id=7,
        device_id="device-b",
    )
    assert second["session_id"] != first["session_id"]
    assert second["session_token"] not in str(await db_session.scalar(select(ExternalAccountLease)))
