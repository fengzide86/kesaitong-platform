"""Local synthetic regressions; no real browser/platform requests or writes."""

import json
from datetime import UTC, datetime, timedelta
from hashlib import sha256

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from core.config import settings
from domains.scenarios import service, staff_execution
from models import AuthCode, Setting, StaffUser, User
from models.scenario import ScenarioAssignment, StaffRuntimePermission, StaffToolGrant
from schemas.scenario import (
    ProjectRuntimeScopeWrite,
    ScenarioAssignmentWrite,
    StaffRuntimePermissionWrite,
    StaffToolGrantRequest,
    exact_origin,
)
from tests.api.test_target_profiles import create_approved, setup_new_tool, target_keys  # noqa: F401

pytestmark = pytest.mark.asyncio
ORIGIN = "https://www.idtrade.cn"


def future():
    return datetime.now(UTC) + timedelta(days=2)


def assignment(**changes):
    return ScenarioAssignmentWrite.model_validate({"expected_revision": 0, "mode": "competition", "entry_url": ORIGIN + "/User/Contest",
        "allowed_origins": [ORIGIN], "expires_at": future(), **changes})


async def customer(db):
    code = AuthCode(code="scenario-fixture", status="active")
    db.add(code)
    await db.flush()
    user = User(name="test", auth_code_id=code.id, is_active=True)
    db.add(user)
    await db.commit()
    return user, code


async def test_no_assignment_preserves_legacy_but_disabling_is_not_absence(db_session):
    user, _ = await customer(db_session)
    policy = await service.effective_policy(db_session, user.id)
    assert policy["status"] == "unassigned" and policy["maxScenes"] == 1
    await service.assert_customer_access(db_session, user.id, "https://training.test/path")
    row = await service.save_assignment(db_session, "user", user.id, assignment(), 1)
    assert row["revision"] == 1
    await service.save_assignment(db_session, "user", user.id, assignment(expected_revision=1, status="disabled"), 1)
    with pytest.raises(HTTPException, match="403"):
        await service.assert_customer_access(db_session, user.id, ORIGIN)
    assert (await service.effective_policy(db_session, user.id))["status"] == "blocked"


async def test_code_assignment_covers_users_and_intersects_user_scope(db_session):
    user, code = await customer(db_session)
    await service.save_assignment(db_session, "auth_code", code.id, assignment(), 1)
    await service.save_assignment(db_session, "user", user.id, assignment(mode="training", entry_url=ORIGIN + "/training", allowed_origins=[ORIGIN, "https://other.test"]), 1)
    policy = await service.effective_policy(db_session, user.id)
    assert policy["mode"] == "competition" and policy["allowedOrigins"] == [ORIGIN]
    assert (await service.assert_customer_access(db_session, user.id, ORIGIN + "/any/business/path"))["status"] == "active"
    for url in ["http://www.idtrade.cn", "https://www.idtrade.cn:444", "https://www.idtrade.cn.evil.test", "https://sub.www.idtrade.cn"]:
        with pytest.raises(HTTPException):
            await service.assert_customer_access(db_session, user.id, url)
    with pytest.raises(HTTPException):
        await service.assert_customer_access(db_session, user.id, ORIGIN, mode="training")


async def test_cas_conflict_and_expiry_fail_closed(db_session):
    user, _ = await customer(db_session)
    await service.save_assignment(db_session, "user", user.id, assignment(), 1)
    with pytest.raises(HTTPException) as error:
        await service.save_assignment(db_session, "user", user.id, assignment(expected_revision=2), 1)
    assert error.value.status_code == 409
    await db_session.rollback()
    row = await db_session.scalar(select(ScenarioAssignment))
    row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    await db_session.commit()
    assert (await service.effective_policy(db_session, row.subject_id))["status"] == "blocked"


@pytest.mark.parametrize("raw", ["https://name:password@example.test", "javascript:alert(1)", "https://example.test\\evil", " https://example.test", "https://example.test:0"])
async def test_origin_rejects_ambiguous_urls(raw):
    with pytest.raises(ValueError):
        exact_origin(raw)


async def test_origin_normalizes_default_port_but_preserves_security_boundary():
    assert exact_origin("https://EXAMPLE.test:443/path") == "https://example.test"
    assert exact_origin("https://example.test:444/path") == "https://example.test:444"
    with pytest.raises(ValidationError):
        assignment(entry_url="https://www.idtrade.cn/User/Other")
    with pytest.raises(ValidationError):
        StaffRuntimePermissionWrite(expected_revision=0, enabled=True, allowed_origins=[ORIGIN], max_scenes=11, expires_at=future())


async def test_customer_cannot_assign_or_obtain_staff_grants(client, db_session):
    from core.security import create_access_token
    user, _ = await customer(db_session)
    headers = {"Authorization": "Bearer " + create_access_token({"user_id": user.id})}
    for path, payload in [(f"/api/scenarios/assignments/user/{user.id}", assignment().model_dump(mode="json")),
                          (f"/api/scenarios/staff/{user.id}/permission", {"expected_revision": 0, "expires_at": future().isoformat()})]:
        assert (await client.put(path, headers=headers, json=payload)).status_code in {401, 403}
    result = await client.post("/api/scenarios/staff/launch-grant", headers=headers, json={"device_id": "test", "account_slot": "one", "origin": ORIGIN})
    assert result.status_code in {401, 403}


async def test_staff_permission_not_implicit_and_defaults_six(client, auth_headers, db_session):
    actor = await db_session.scalar(select(StaffUser).where(StaffUser.username == "admin"))
    assert (await client.get("/api/scenarios/me", headers=auth_headers)).status_code == 403
    req = StaffRuntimePermissionWrite(expected_revision=0, enabled=True, allowed_origins=[ORIGIN], expires_at=future())
    saved = await service.save_staff_permission(db_session, actor.id, req, actor.id)
    assert saved["max_scenes"] == 6 and saved["allowed_capabilities"] == []
    policy = (await client.get("/api/scenarios/me", headers=auth_headers)).json()["data"]
    assert policy["principal"] == {"kind": "staff", "id": str(actor.id)}
    assert (await client.get("/api/scenarios/staff/permissions", headers=auth_headers)).json()["data"][0] == saved
    with pytest.raises(HTTPException) as err:
        await service.save_staff_permission(db_session, actor.id, req, actor.id)
    assert err.value.status_code == 409


@pytest.mark.usefixtures("target_keys")
async def test_project_mapping_only_uses_same_site_and_mode_signed_scopes(client, auth_headers, db_session):
    signed = await create_approved(client, auth_headers)
    profile = signed["profile"]
    values = {"expected_revision": 0, "project_id": "training-A", "site_origin": exact_origin(profile["entryUrl"]), "mode": "training", "course_refs": ["d" * 64]}
    approved = await service.save_project_scope(db_session, ProjectRuntimeScopeWrite(**values), 1)
    assert approved["revision"] == 1
    await service.assert_project_scope(db_session, values["project_id"], values["site_origin"], "training", "d" * 64)
    for changed in [{"course_refs": ["f" * 64]}, {"mode": "competition"}, {"site_origin": "https://other.test"}]:
        with pytest.raises(HTTPException) as err:
            await service.save_project_scope(db_session, ProjectRuntimeScopeWrite(**{**values, "expected_revision": 1, **changed}), 1)
        assert err.value.status_code == 403
    with pytest.raises(HTTPException):
        await service.assert_project_scope(db_session, "different-project", values["site_origin"], "training", "d" * 64)


async def staff_setup(client, auth_headers, db_session):
    signed = await create_approved(client, auth_headers)
    staff = await db_session.scalar(select(StaffUser).where(StaffUser.username == "admin"))
    origins = sorted({route["origin"] for route in signed["profile"]["allowedRoutes"]})
    await service.save_staff_permission(db_session, staff.id, StaffRuntimePermissionWrite(expected_revision=0, enabled=True,
        allowed_origins=origins, allowed_capabilities=["template.create.v1"], expires_at=future()), staff.id)
    db_session.add(Setting(key="tool_configs", value=json.dumps([{"id": "staff-template", "name": "fixture", "platform_key": "amazon",
        "capability_key": "logistics_standard", "target_capability": "template.create.v1", "requires_target_profile": True,
        "script_key": "bjysoft.v2.template", "runner_api_version": 2, "availability": "live", "script_status": "script_ready", "release_status": "available"}])))
    await db_session.commit()
    req = StaffToolGrantRequest(tool_id="staff-template", target_profile_id=signed["profile"]["id"], target_profile_revision=signed["profile"]["revision"],
        device_id="staff-device", account_slot="account-A", attempt_id="unique-attempt", context_hash="a" * 64, input_hash="b" * 64)
    actor = {"user_id": staff.id, "staff_id": staff.id, "role": staff.role, "token_version": staff.token_version}
    return actor, req


@pytest.mark.usefixtures("target_keys")
async def test_staff_independent_grant_one_use_and_reports_immutable(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    actor, req = await staff_setup(client, auth_headers, db_session)
    result = await staff_execution.issue(db_session, actor, req)
    token = result["launch_data"]["token"]
    row = await db_session.scalar(select(StaffToolGrant))
    assert row.token_hash == sha256(token.encode()).hexdigest() and token not in row.token_hash
    assert not hasattr(row, "auth_code_id")
    with pytest.raises(HTTPException):
        await staff_execution.report(db_session, {"token": token, "run_id": "test", "status": "success"})
    verified = await staff_execution.consume(db_session, actor, token)
    assert verified["principal_kind"] == "staff" and verified["account_slot"] == "account-A"
    with pytest.raises(HTTPException):
        await staff_execution.consume(db_session, actor, token)
    receipt = {"token": token, "run_id": "test", "status": "success"}
    assert not (await staff_execution.report(db_session, receipt))["duplicate"]
    assert (await staff_execution.report(db_session, receipt))["duplicate"]
    with pytest.raises(HTTPException):
        await staff_execution.report(db_session, {**receipt, "status": "failed"})
    assert "token" not in row.report


@pytest.mark.usefixtures("target_keys")
async def test_staff_revocation_or_session_change_blocks_consumption(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    actor, req = await staff_setup(client, auth_headers, db_session)
    token = (await staff_execution.issue(db_session, actor, req))["launch_data"]["token"]
    with pytest.raises(HTTPException):
        await staff_execution.consume(db_session, {**actor, "token_version": actor["token_version"] + 1}, token)
    permission = await db_session.get(StaffRuntimePermission, actor["user_id"])
    permission.revision += 1
    await db_session.commit()
    with pytest.raises(HTTPException):
        await staff_execution.consume(db_session, actor, token)
    assert (await db_session.scalar(select(StaffToolGrant))).status == "pending"


@pytest.mark.usefixtures("target_keys")
async def test_staff_browsing_permission_never_implies_write_permission(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    actor, req = await staff_setup(client, auth_headers, db_session)
    permission = await db_session.get(StaffRuntimePermission, actor["user_id"])
    permission.allowed_capabilities = []
    await db_session.commit()
    with pytest.raises(HTTPException):
        await staff_execution.issue(db_session, actor, req)
    assert await db_session.scalar(select(StaffToolGrant)) is None


@pytest.mark.usefixtures("target_keys")
async def test_staff_reconciliation_keeps_original_and_checks_owner_device_slot_context(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    actor, req = await staff_setup(client, auth_headers, db_session)
    token = (await staff_execution.issue(db_session, actor, req))["launch_data"]["token"]
    await staff_execution.consume(db_session, actor, token)
    receipt = {"token": token, "run_id": "run-one", "status": "failed"}
    await staff_execution.report(db_session, receipt)
    evidence = {"run_id": "run-one", "device_id": req.device_id, "account_slot": req.account_slot,
        "context_hash": req.context_hash, "input_hash": req.input_hash, "status": "succeeded", "verification": "same-object-list-and-details", "object_ref": "22"}
    for change in [{"device_id": "other"}, {"account_slot": "other"}, {"context_hash": "f" * 64}, {"input_hash": "c" * 64}]:
        with pytest.raises(HTTPException):
            await staff_execution.reconcile(db_session, actor, {**evidence, **change})
    with pytest.raises(HTTPException):
        await staff_execution.reconcile(db_session, {**actor, "user_id": 99}, evidence)
    assert not (await staff_execution.reconcile(db_session, actor, evidence))["duplicate"]
    assert (await staff_execution.reconcile(db_session, actor, evidence))["duplicate"]
    assert (await staff_execution.report(db_session, receipt))["duplicate"]
    row = await db_session.scalar(select(StaffToolGrant))
    assert row.report["status"] == "failed" and row.report["reconciliation"] == evidence


async def trial_setup(client, auth_headers, db, monkeypatch):
    from models.commercial import CommercialGrant, TrialQuota
    headers, params, signed = await setup_new_tool(client, auth_headers, db, monkeypatch)
    code = await db.scalar(select(AuthCode))
    code.plan_id = None
    origin = exact_origin(signed["profile"]["entryUrl"])
    row = await db.scalar(select(Setting).where(Setting.key == "tool_configs"))
    tool = json.loads(row.value)[0]
    tool["capability_key"] = "logistics_standard"
    row.value = json.dumps([tool])
    grant = CommercialGrant(auth_code_id=code.id, offer_id=1, snapshot=json.dumps({"definition": {"business_line": "trial", "allowed_capabilities": ["template.create"]}, "scene_type": "training"}),
        project_id="training-A", site_origin=origin, ends_at=future().replace(tzinfo=None), status="active", created_by_staff_id=1)
    db.add(grant)
    await db.flush()
    db.add(TrialQuota(grant_id=grant.id, capability="template.create", available=1, consumed=0))
    await db.commit()
    await service.save_project_scope(db, ProjectRuntimeScopeWrite(expected_revision=0, project_id="training-A", site_origin=origin, mode="training", course_refs=["d" * 64]), 1)
    params["course_ref"] = "d" * 64
    return headers, params


@pytest.mark.usefixtures("target_keys")
async def test_trial_launch_reserves_atomically_and_report_consumes_once(client, auth_headers, db_session, monkeypatch):
    from models.commercial import TrialQuota, TrialReservation
    headers, params = await trial_setup(client, auth_headers, db_session, monkeypatch)
    created = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)
    assert created.status_code == 200, created.text
    token = created.json()["data"]["token"]
    assert (await db_session.scalar(select(TrialQuota))).available == 0
    assert (await db_session.scalar(select(TrialReservation))).status == "reserved"
    # Client-declared result cannot consume anything before server verification.
    report = {"token": token, "run_id": "trial-real-run", "status": "succeeded"}
    assert (await client.post("/api/executions/report", json=report)).status_code == 409
    assert (await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)).status_code == 409
    assert (await client.post("/api/tools/launch-grant/verify", json={"token": token})).json()["success"]
    assert (await client.post("/api/executions/report", json=report)).json()["success"]
    assert (await client.post("/api/executions/report", json=report)).json()["data"]["duplicate"]
    await db_session.refresh(await db_session.scalar(select(TrialQuota)))
    quota = await db_session.scalar(select(TrialQuota))
    assert quota.available == 0 and quota.consumed == 1


@pytest.mark.usefixtures("target_keys")
async def test_trial_expired_unconsumed_grant_releases_but_unknown_used_does_not(client, auth_headers, db_session, monkeypatch):
    from models import LaunchToken
    from models.commercial import TrialQuota, TrialReservation
    headers, params = await trial_setup(client, auth_headers, db_session, monkeypatch)
    first = (await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)).json()["data"]["token"]
    old = await db_session.scalar(select(LaunchToken).where(LaunchToken.token == first))
    old.expires_at = datetime.now() - timedelta(seconds=1)
    await db_session.commit()
    second = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)
    assert second.status_code == 200, second.text
    token = second.json()["data"]["token"]
    assert token != first
    assert [row.status for row in (await db_session.execute(select(TrialReservation).order_by(TrialReservation.id))).scalars()] == ["released", "reserved"]
    assert not (await client.post("/api/tools/launch-grant/verify", json={"token": first})).json()["success"]
    await client.post("/api/tools/launch-grant/verify", json={"token": token})
    await client.post("/api/executions/report", json={"token": token, "run_id": "unknown-run", "status": "failed", "page_changed": False})
    assert (await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)).status_code == 409
    assert (await db_session.scalar(select(TrialQuota))).available == 0
    reconciled = await client.post("/api/executions/reconcile", headers=headers, json={"run_id": "unknown-run", "status": "succeeded", "verification": "same-object-list-and-details", "object_ref": "22"})
    assert reconciled.status_code == 200, reconciled.text
    quota = await db_session.scalar(select(TrialQuota).execution_options(populate_existing=True))
    assert quota.available == 0 and quota.consumed == 1


@pytest.mark.usefixtures("target_keys")
async def test_commercial_launch_rejects_forged_course_before_any_quota_or_token(client, auth_headers, db_session, monkeypatch):
    from models import LaunchToken
    from models.commercial import TrialQuota, TrialReservation
    headers, params = await trial_setup(client, auth_headers, db_session, monkeypatch)
    result = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params={**params, "course_ref": "f" * 64})
    assert result.status_code == 403
    assert await db_session.scalar(select(LaunchToken)) is None
    assert await db_session.scalar(select(TrialReservation)) is None
    assert (await db_session.scalar(select(TrialQuota))).available == 1
