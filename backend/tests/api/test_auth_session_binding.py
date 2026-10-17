"""Regression tests for the one-device customer auth session contract."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import verify_token
from models import AuthCode


async def test_customer_session_claims_and_second_device_rejection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    code = AuthCode(
        code="SESSION-BOUND-CUSTOMER",
        status="unused",
        max_devices=3,
        seat_limit=3,
    )
    db_session.add(code)
    await db_session.commit()

    first = await client.post(
        "/api/auth/verify",
        json={"code": code.code, "device_id": "session-device-a", "device_name": "同一电脑"},
    )
    assert first.json()["success"] is True
    first_token = first.json()["data"]["token"]
    first_payload = verify_token(first_token)
    assert first_payload and first_payload["session_id"] and first_payload["session_token"]

    second = await client.post(
        "/api/auth/verify",
        json={"code": code.code, "device_id": "session-device-b", "device_name": "另一台电脑"},
    )
    assert second.json()["success"] is False
    assert "其他设备" in second.json()["message"]


async def test_customer_same_device_relogin_replaces_session(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    code = AuthCode(
        code="SESSION-SAME-DEVICE",
        status="unused",
        max_devices=1,
        seat_limit=1,
    )
    db_session.add(code)
    await db_session.commit()

    first = await client.post(
        "/api/auth/verify",
        json={"code": code.code, "device_id": "stable-device", "device_name": "同一电脑"},
    )
    second = await client.post(
        "/api/auth/verify",
        json={"code": code.code, "device_id": "stable-device", "device_name": "同一电脑"},
    )
    assert first.json()["success"] is True
    assert second.json()["success"] is True
    first_payload = verify_token(first.json()["data"]["token"])
    second_payload = verify_token(second.json()["data"]["token"])
    assert first_payload and second_payload
    assert first_payload["session_id"] != second_payload["session_id"]

