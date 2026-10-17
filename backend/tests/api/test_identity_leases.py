"""HTTP contract tests for customer/staff identity-lease routes."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import AuthCode

pytestmark = pytest.mark.asyncio


async def _customer_login(
    client: AsyncClient,
    db_session: AsyncSession,
    code_value: str,
    device_id: str,
) -> tuple[str, int]:
    """Create a disposable customer authorization and return its bearer token."""

    code = AuthCode(
        code=code_value,
        status="unused",
        max_devices=1,
        seat_limit=1,
    )
    db_session.add(code)
    await db_session.commit()
    response = await client.post(
        "/api/auth/verify",
        json={"code": code_value, "device_id": device_id, "device_name": "路由测试电脑"},
    )
    body = response.json()
    assert response.status_code == 200, body
    assert body["success"] is True, body
    return body["data"]["token"], code.id


def _lease_request(
    *,
    external_account_ref: str = "customer-account-a",
    scene_id: str = "scene-a",
    account_slot: str = "single",
) -> dict[str, Any]:
    return {
        "site_origin": "https://seller.example",
        "external_account_ref": external_account_ref,
        "device_id": "customer-device-a",
        "workspace_id": "customer",
        "account_slot": account_slot,
        "scene_id": scene_id,
    }


async def test_identity_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/identity/leases")
    assert response.status_code == 401

    response = await client.get("/api/identity/admin/leases")
    assert response.status_code == 401


async def test_customer_lease_conflict_and_safe_response(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    token, _ = await _customer_login(client, db_session, "HTTP-LEASE-CONFLICT", "customer-device-a")
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.post("/api/identity/leases", headers=headers, json=_lease_request())
    assert first.status_code == 200, first.json()
    first_data = first.json()["data"]
    assert first_data["lease_token"]
    assert "customer-account-a" not in str(first_data)
    assert first_data["external_account_hint"]

    second = await client.post(
        "/api/identity/leases",
        headers=headers,
        json=_lease_request(external_account_ref="customer-account-b", scene_id="scene-b"),
    )
    assert second.status_code == 409
    assert "已经在其他现场使用" in second.json().get("message", "")


async def test_lease_heartbeat_release_and_invalid_token(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    token, _ = await _customer_login(client, db_session, "HTTP-LEASE-LIFECYCLE", "customer-device-a")
    headers = {"Authorization": f"Bearer {token}"}
    acquired = await client.post("/api/identity/leases", headers=headers, json=_lease_request())
    assert acquired.status_code == 200, acquired.json()
    lease = acquired.json()["data"]

    heartbeat = await client.post(
        f"/api/identity/leases/{lease['id']}/heartbeat",
        headers=headers,
        json={"lease_token": lease["lease_token"]},
    )
    assert heartbeat.status_code == 200, heartbeat.json()
    assert heartbeat.json()["data"]["revision"] > lease["revision"]

    bad_heartbeat = await client.post(
        f"/api/identity/leases/{lease['id']}/heartbeat",
        headers=headers,
        json={"lease_token": "lease.invalid-token-that-is-long-enough"},
    )
    assert bad_heartbeat.status_code == 404

    released = await client.post(
        f"/api/identity/leases/{lease['id']}/release",
        headers=headers,
        json={"lease_token": lease["lease_token"]},
    )
    assert released.status_code == 200, released.json()
    assert released.json()["success"] is True


async def test_lease_owner_boundary_returns_forbidden(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_token, _ = await _customer_login(client, db_session, "HTTP-LEASE-OWNER-A", "customer-device-a")
    other_token, _ = await _customer_login(client, db_session, "HTTP-LEASE-OWNER-B", "customer-device-b")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    other_headers = {"Authorization": f"Bearer {other_token}"}
    acquired = await client.post("/api/identity/leases", headers=owner_headers, json=_lease_request())
    assert acquired.status_code == 200, acquired.json()
    lease = acquired.json()["data"]

    response = await client.post(
        f"/api/identity/leases/{lease['id']}/heartbeat",
        headers=other_headers,
        json={"lease_token": lease["lease_token"]},
    )
    assert response.status_code == 403

    response = await client.post(
        f"/api/identity/leases/{lease['id']}/release",
        headers=other_headers,
        json={"lease_token": lease["lease_token"]},
    )
    assert response.status_code == 403


async def test_admin_can_list_leases_but_customer_cannot(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_token: str,
) -> None:
    customer_token, _ = await _customer_login(client, db_session, "HTTP-LEASE-LIST", "customer-device-a")
    customer_headers = {"Authorization": f"Bearer {customer_token}"}
    acquired = await client.post("/api/identity/leases", headers=customer_headers, json=_lease_request())
    assert acquired.status_code == 200, acquired.json()

    forbidden = await client.get("/api/identity/admin/leases", headers=customer_headers)
    # Staff-only dependencies intentionally do not treat a customer JWT as a
    # staff identity; the boundary is therefore an authentication rejection.
    assert forbidden.status_code == 401

    listed = await client.get(
        "/api/identity/admin/leases",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert listed.status_code == 200, listed.json()
    rows = listed.json()["data"]
    assert any(row["id"] == acquired.json()["data"]["id"] for row in rows)
    assert all("lease_token" not in row for row in rows)


async def test_admin_takeover_rebinds_customer_and_missing_code_is_404(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_token: str,
) -> None:
    customer_token, auth_code_id = await _customer_login(
        client,
        db_session,
        "HTTP-LEASE-TAKEOVER",
        "customer-device-a",
    )
    customer_headers = {"Authorization": f"Bearer {customer_token}"}
    acquired = await client.post("/api/identity/leases", headers=customer_headers, json=_lease_request())
    assert acquired.status_code == 200, acquired.json()

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    takeover = await client.post(
        f"/api/identity/admin/bindings/{auth_code_id}/takeover",
        headers=admin_headers,
        json={
            "site_origin": "https://seller.example",
            "external_account_ref": "customer-account-b",
            "reason": "客户确认更换平台账号",
        },
    )
    assert takeover.status_code == 200, takeover.json()
    data = takeover.json()["data"]
    assert data["auth_code_id"] == auth_code_id
    assert data["replaced_binding_id"] is not None
    assert "customer-account-b" not in str(data)

    missing = await client.post(
        "/api/identity/admin/bindings/999999/takeover",
        headers=admin_headers,
        json={
            "site_origin": "https://seller.example",
            "external_account_ref": "customer-account-c",
            "reason": "不存在授权码",
        },
    )
    assert missing.status_code == 404

