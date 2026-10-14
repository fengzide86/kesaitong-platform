"""No network or platform writes: registry, signing and launch boundaries."""

import asyncio
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings
from database import Base
from models import AuditLog, LaunchToken, Setting
from schemas.target_profiles import TargetProfile, TargetProfileReview, TargetProfileSubmission, TargetRoute
from services import target_profile_service as service
from services.tool_release_service import create_release, save_releases, verify_manifest_signature
from tests.api.test_tools import _seed_live_launch_access
from tests.services.test_tool_release_service import key_pair


@pytest.fixture
def target_keys(monkeypatch):
    private, public = key_pair()
    monkeypatch.setattr(settings, "TOOL_SIGNING_PRIVATE_KEY_B64", private)
    monkeypatch.setattr(settings, "TOOL_SIGNING_PUBLIC_KEY_B64", public)
    monkeypatch.setattr(settings, "TOOL_SIGNING_KEY_ID", "target-test-key")
    return private, public


def submission(url="http://www.bjysoft.cn:8730/User/Welcome6"):
    return {"name": "实训入口", "entryUrl": url, "edition": "v2", "evidence": {
        "edition": "v2", "pageFingerprint": "a" * 64, "markers": ["amazon-v2", "seller-shipping-template"],
    }}


def approval(revision=1, **overrides):
    return {"revision": revision, "reviewStatus": "approved", "edition": "v2",
            "allowedRoutes": [
                {"origin": "http://www.bjysoft.cn:8730", "pathPrefix": "/User/Welcome6", "role": "entry"},
                {"origin": "http://www.bjysoft.cn:8732", "pathPrefix": "/User", "role": "login"},
                {"origin": "http://www.bjysoft.cn:8732", "pathPrefix": "/ECrossAmazon", "role": "business"},
            ], "capabilities": ["template.create.v1"], "adapterVersion": "bjysoft-v2-template.1",
            "evidence": {"edition": "v2", "pageFingerprint": "a" * 64,
                         "markers": ["amazon-v2", "seller-shipping-template"], "source": "admin-verified",
                         "pageFingerprints": {"courseMap": "b" * 64, "templateList": "a" * 64, "templateEditor": "c" * 64}},
            "executionScopes": [{"scenario": "training", "stage": "not_applicable", "courseRef": "d" * 64,
                                 "source": "admin-verified", "evidenceRef": "fixture-scope-20261012"}], **overrides}


async def create_approved(client, headers):
    created = await client.post("/api/tools/target-profiles", headers=headers, json=submission())
    assert created.status_code == 200, created.text
    profile_id = created.json()["data"]["profile"]["id"]
    reviewed = await client.post(f"/api/tool-releases/target-profiles/{profile_id}/review", headers=headers, json=approval())
    assert reviewed.status_code == 200, reviewed.text
    return reviewed.json()["data"]


@pytest.mark.asyncio
async def test_registration_sanitizes_url_and_deduplicates(client, auth_headers, db_session):
    raw = "http://alice:private-password@www.bjysoft.cn:8730/User/Welcome6?paras=secret-session#private-token"
    response = await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission(raw))
    assert response.status_code == 200, response.text
    package = response.json()["data"]
    assert package["profile"]["entryUrl"] == "http://www.bjysoft.cn:8730/User/Welcome6"
    assert package["profile"]["reviewStatus"] == "pending"
    assert package["profile"]["capabilities"] == [] and package["signature"] is None
    assert package["profile"]["allowedRoutes"] == []
    again = await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission())
    assert again.json()["data"] == package
    persisted = (await db_session.execute(select(Setting).where(Setting.key.startswith(service.PROFILE_PREFIX)))).scalar_one()
    for value in ("private-password", "secret-session", "private-token", "paras=", "alice"):
        assert value not in persisted.value and value not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("url", ["file:///C:/secret", "javascript:alert(1)", "http://127.0.0.1:8080/a", "http://192.168.1.2/a", "https://*.example.com/a", "https://example.com/a/../b", "https://example.com/a%2fb", "https://example.com//a", "https://classroom.local/a", "https://[2606:4700:4700::1111]/a", "https://example.com/" + "a" * 2048])
async def test_invalid_target_urls_do_not_register(client, auth_headers, url):
    response = await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission(url))
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("evidence", [
    {"pageFingerprint": "A" * 64},
    {"markers": ["amazon-v2"] * 5},
])
async def test_evidence_contract_matches_desktop_constraints(client, auth_headers, db_session, evidence):
    payload = submission()
    payload["evidence"].update(evidence)
    response = await client.post("/api/tools/target-profiles", headers=auth_headers, json=payload)
    assert response.status_code == 422
    assert (await db_session.execute(select(Setting).where(Setting.key.startswith(service.PROFILE_PREFIX)))).scalars().all() == []


def test_profile_limits_match_shared_desktop_contract():
    assert TargetProfile.model_json_schema()["properties"]["name"]["maxLength"] == 100
    assert TargetProfileSubmission.model_json_schema()["properties"]["name"]["maxLength"] == 100
    assert TargetProfile.model_json_schema()["properties"]["entryUrl"]["maxLength"] == 2048
    assert TargetRoute.model_json_schema()["properties"]["origin"]["maxLength"] == 300
    assert TargetRoute.model_json_schema()["properties"]["pathPrefix"]["maxLength"] == 300


@pytest.mark.asyncio
@pytest.mark.parametrize("length", [100, 101])
async def test_registration_name_exact_boundary(client, auth_headers, length):
    response = await client.post("/api/tools/target-profiles", headers=auth_headers, json={**submission(), "name": "a" * length})
    assert response.status_code == (200 if length == 100 else 422)


@pytest.mark.asyncio
async def test_registration_strips_long_query_but_enforces_clean_entry_limit(client, auth_headers):
    raw = "https://school.example/entry?paras=" + "private" * 500
    response = await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission(raw))
    assert response.status_code == 200
    assert response.json()["data"]["profile"]["entryUrl"] == "https://school.example/entry"
    base = "https://school.example/"
    at_limit = base + "a" * (2048 - len(base))
    assert (await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission(at_limit))).status_code == 200
    assert (await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission(at_limit + "a"))).status_code == 422


@pytest.mark.asyncio
async def test_validation_never_echoes_raw_credentials(client, auth_headers):
    response = await client.post("/api/tools/target-profiles", headers=auth_headers, json={**submission(), "token": "private-token-value"})
    assert response.status_code == 422
    assert "private-token-value" not in response.text
    response = await client.post("/api/tool-releases/target-profiles/missing/review", headers=auth_headers, json={"revision": "private-secret"})
    assert response.status_code == 422 and "private-secret" not in response.text


@pytest.mark.asyncio
async def test_approved_profile_is_signed_revisioned_and_audited(client, auth_headers, db_session, target_keys):
    package = await create_approved(client, auth_headers)
    assert package["profile"]["revision"] == 2
    assert package["signingKeyId"] == "target-test-key"
    assert verify_manifest_signature(package["profile"], package["signature"], target_keys[1])
    package["profile"]["allowedRoutes"][0]["origin"] = "https://unapproved.example.com"
    assert not verify_manifest_signature(package["profile"], package["signature"], target_keys[1])
    stale = await client.post(f"/api/tool-releases/target-profiles/{package['profile']['id']}/review", headers=auth_headers, json=approval())
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "TARGET_PROFILE_REVISION_CONFLICT"
    audit = (await db_session.execute(select(AuditLog).where(AuditLog.action == "target_profile_review"))).scalar_one()
    assert json.loads(audit.detail)["toRevision"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("review_status", ["rejected", "disabled"])
async def test_status_only_review_ignores_unsaved_approval_draft(client, auth_headers, target_keys, review_status):
    saved = await create_approved(client, auth_headers)
    before = saved["profile"]
    response = await client.post(
        f"/api/tool-releases/target-profiles/{before['id']}/review",
        headers=auth_headers,
        json={"revision": before["revision"], "reviewStatus": review_status},
    )
    assert response.status_code == 200, response.text
    after = response.json()["data"]
    assert after["profile"]["revision"] == before["revision"] + 1
    assert after["profile"]["reviewStatus"] == review_status
    assert after["profile"]["name"] == before["name"]
    assert after["profile"]["entryUrl"] == before["entryUrl"]
    assert after["profile"]["allowedRoutes"] == before["allowedRoutes"]
    assert after["profile"]["evidence"] == before["evidence"]
    assert after["profile"]["capabilities"] == []
    assert after["profile"]["adapterVersion"] is None
    assert after["profile"]["executionScopes"] == []
    assert after["signature"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {"edition": "unknown"}, {"edition": "v3"}, {"adapterVersion": None},
    {"evidence": {"edition": "v2", "markers": ["amazon-v2"], "source": "admin-verified"}},
    {"evidence": {"edition": "v2", "pageFingerprint": "a" * 64, "markers": ["amazon-v2", "seller-shipping-template"], "source": "client-observed"}},
    {"evidence": {"edition": "v2", "pageFingerprint": "a" * 64, "markers": ["amazon-v2", "amazon-v3", "seller-shipping-template"], "source": "admin-verified"}},
    {"allowedRoutes": [{"origin": "http://www.bjysoft.cn:8730", "pathPrefix": "/", "role": "entry"}]},
    {"allowedRoutes": [{"origin": "http://www.bjysoft.cn:8730", "pathPrefix": "/User/Welcome6", "role": "entry"}]},
])
async def test_template_approval_requires_verified_v2_evidence(client, auth_headers, target_keys, changes):
    created = (await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission())).json()["data"]
    response = await client.post(f"/api/tool-releases/target-profiles/{created['profile']['id']}/review", headers=auth_headers, json=approval(**changes))
    assert response.status_code in {409, 422}
    listed = (await client.get("/api/tools/target-profiles", headers=auth_headers)).json()["data"]
    assert listed[0]["profile"]["reviewStatus"] == "pending"


@pytest.mark.asyncio
async def test_approval_without_signing_key_fails_closed(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_SIGNING_PRIVATE_KEY_B64", "")
    created = (await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission())).json()["data"]
    response = await client.post(f"/api/tool-releases/target-profiles/{created['profile']['id']}/review", headers=auth_headers, json=approval())
    assert response.status_code == 503
    listed = (await client.get("/api/tools/target-profiles", headers=auth_headers)).json()["data"]
    assert listed[0]["profile"]["reviewStatus"] == "pending"


@pytest.mark.asyncio
async def test_profile_routes_need_login_and_release_permission(client, auth_headers, staff_headers_factory):
    assert (await client.get("/api/tools/target-profiles")).status_code == 401
    operator = await staff_headers_factory("operator", "target-operator")
    assert (await client.get("/api/tool-releases/target-profiles", headers=operator)).status_code == 403
    assert (await client.post("/api/tool-releases/target-profiles/no/review", headers=operator, json=approval())).status_code == 403
    assert (await client.get("/api/tool-releases/target-profiles", headers=auth_headers)).status_code == 200


@pytest.mark.asyncio
async def test_pending_profiles_are_owner_scoped(client, auth_headers, db_session):
    await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission())
    token, _ = await _seed_live_launch_access(db_session)
    own_headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/tools/target-profiles", headers=own_headers)).json()["data"] == []
    await client.post("/api/tools/target-profiles", headers=own_headers, json=submission())
    assert len((await client.get("/api/tools/target-profiles", headers=own_headers)).json()["data"]) == 1
    assert len((await client.get("/api/tool-releases/target-profiles", headers=auth_headers)).json()["data"]) == 2


async def setup_new_tool(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    signed = await create_approved(client, auth_headers)
    token, _ = await _seed_live_launch_access(db_session)
    row = (await db_session.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one()
    tool = json.loads(row.value)[0]
    tool.update(runner_api_version=2, requires_target_profile=True, target_capability="template.create.v1", script_key="bjysoft-v2-template.1")
    row.value = json.dumps([tool])
    await db_session.commit()
    params = {"platform_key": "amazon", "client_runner_api_version": 2, "target_profile_id": signed["profile"]["id"], "target_profile_revision": 2}
    return {"Authorization": f"Bearer {token}"}, params, signed


@pytest.mark.asyncio
async def test_protocol_two_grant_contains_signed_profile_and_verify_binding(client, auth_headers, db_session, target_keys, monkeypatch):
    headers, params, signed = await setup_new_tool(client, auth_headers, db_session, monkeypatch)
    response = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)
    assert response.status_code == 200, response.text
    grant = response.json()["data"]["launch_data"]
    assert grant["target_profile"] == signed
    assert grant["target_url"] == signed["profile"]["entryUrl"]
    assert grant["runner_api_version"] == 2
    assert grant["tool_manifest"]["targetProfileRevision"] == 2
    assert grant["tool_manifest"]["requiredCapability"] == "template.create.v1"
    assert verify_manifest_signature(grant["tool_manifest"], grant["tool_signature"], target_keys[1])
    verified = await client.post("/api/tools/launch-grant/verify", json={"token": grant["token"]})
    assert verified.json()["data"]["target_profile_revision"] == 2
    assert verified.json()["data"]["required_capability"] == "template.create.v1"
    assert not (await client.post("/api/tools/launch-grant/verify", json={"token": grant["token"]})).json()["success"]


@pytest.mark.asyncio
async def test_catalog_save_preserves_target_protocol_fields(client, auth_headers, db_session, target_keys, monkeypatch):
    headers, params, _ = await setup_new_tool(client, auth_headers, db_session, monkeypatch)
    tools = (await client.get("/api/tools", params={"platform_key": "amazon"})).json()
    saved = await client.put("/api/tools", headers=auth_headers, json=tools)
    assert saved.status_code == 200, saved.text
    listed = (await client.get("/api/tools", params={"platform_key": "amazon"})).json()
    tool = next(item for item in listed if item["id"] == "live_tool")
    assert tool["requires_target_profile"] is True
    assert tool["runner_api_version"] == 2
    assert tool["target_capability"] == "template.create.v1"
    grant = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)
    assert grant.status_code == 200 and grant.json()["data"]["launch_data"]["target_profile"]


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [{"client_runner_api_version": 1}, {"target_profile_revision": 1}, {"target_profile_id": "missing"}, {"target_profile_id": None}])
async def test_new_tool_rejects_old_clients_or_invalid_profile(client, auth_headers, db_session, target_keys, monkeypatch, changes):
    headers, params, _ = await setup_new_tool(client, auth_headers, db_session, monkeypatch)
    params.update(changes)
    params = {key: value for key, value in params.items() if value is not None}
    response = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)
    assert response.status_code == 409
    assert (await db_session.execute(select(LaunchToken))).scalars().all() == []


@pytest.mark.asyncio
async def test_disabling_profile_revokes_unconsumed_grant(client, auth_headers, db_session, target_keys, monkeypatch):
    headers, params, signed = await setup_new_tool(client, auth_headers, db_session, monkeypatch)
    granted = (await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)).json()["data"]
    disabled = await client.post(f"/api/tool-releases/target-profiles/{signed['profile']['id']}/review", headers=auth_headers, json=approval(2, reviewStatus="disabled"))
    assert disabled.status_code == 200 and disabled.json()["data"]["profile"]["revision"] == 3
    result = await client.post("/api/tools/launch-grant/verify", json={"token": granted["token"]})
    assert result.status_code == 409
    launch = (await db_session.execute(select(LaunchToken).where(LaunchToken.token == granted["token"]))).scalar_one()
    assert launch.status == "pending"


@pytest.mark.asyncio
async def test_corrupted_signature_blocks_launch(client, auth_headers, db_session, target_keys, monkeypatch):
    headers, params, signed = await setup_new_tool(client, auth_headers, db_session, monkeypatch)
    row = (await db_session.execute(select(Setting).where(Setting.key == service.PROFILE_PREFIX + signed["profile"]["id"]))).scalar_one()
    stored = json.loads(row.value)
    stored["profile"]["allowedRoutes"][0]["origin"] = "https://other.example.com"
    row.value = json.dumps(stored)
    await db_session.commit()
    response = await client.post("/api/tools/live_tool/launch-grant", headers=headers, params=params)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "TARGET_SIGNATURE_INVALID"
    assert (await db_session.execute(select(LaunchToken))).scalars().all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["scope", "duplicate-course", "courseMap", "templateList", "templateEditor"])
async def test_creation_requires_reviewed_scope_and_each_page(client, auth_headers, target_keys, missing):
    created = (await client.post("/api/tools/target-profiles", headers=auth_headers, json=submission())).json()["data"]
    payload = approval()
    if missing == "scope":
        payload["executionScopes"] = []
    elif missing == "duplicate-course":
        payload["executionScopes"] *= 2
    else:
        payload["evidence"]["pageFingerprints"].pop(missing)
    response = await client.post(f"/api/tool-releases/target-profiles/{created['profile']['id']}/review", headers=auth_headers, json=payload)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_scope_is_signed_and_cannot_claim_competition(client, auth_headers, target_keys):
    package = await create_approved(client, auth_headers)
    package["profile"]["executionScopes"][0]["courseRef"] = "e" * 64
    assert not verify_manifest_signature(package["profile"], package["signature"], target_keys[1])
    payload = approval(2)
    payload["executionScopes"][0].update(scenario="competition", stage="formal")
    response = await client.post(f"/api/tool-releases/target-profiles/{package['profile']['id']}/review", headers=auth_headers, json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_legacy_signed_profile_without_scope_requires_rereview(client, auth_headers, db_session, target_keys):
    package = await create_approved(client, auth_headers)
    row = (await db_session.execute(select(Setting).where(Setting.key == service.PROFILE_PREFIX + package["profile"]["id"]))).scalar_one()
    stored = json.loads(row.value)
    stored["profile"].pop("executionScopes")
    stored["signature"] = service.sign_manifest(stored["profile"])
    row.value = json.dumps(stored)
    await db_session.commit()
    with pytest.raises(HTTPException) as error:
        await service.approved_profile(db_session, package["profile"]["id"], 2, service.TEMPLATE_CAPABILITY)
    assert error.value.detail["code"] == "TARGET_REVIEW_UPGRADE_REQUIRED"


@pytest.mark.asyncio
async def test_only_protocol_two_release_never_falls_back_for_old_client(client, db_session, target_keys, monkeypatch):
    monkeypatch.setattr(settings, "TOOL_EXECUTION_MODE", "live")
    token, _ = await _seed_live_launch_access(db_session)
    release = create_release({"tool_id": "live_tool", "version": "2.0.0", "script_key": "new.adapter.v2", "runner_api_version": 2,
                              "required_capability": "template.create.v1", "status": "published", "channel": "stable"}, target_keys[0])
    await save_releases(db_session, [release])
    result = await client.post("/api/tools/live_tool/launch-grant", headers={"Authorization": f"Bearer {token}"}, params={"platform_key": "amazon"})
    assert result.status_code == 409 and result.json()["detail"]["code"] == "RUNNER_VERSION_MISMATCH"


@pytest.mark.asyncio
async def test_concurrent_review_uses_revision_not_last_writer_wins(tmp_path, target_keys):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'target-registry.sqlite').as_posix()}", connect_args={"timeout": 10})
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    actor = {"staff_id": 1, "username": "reviewer", "role": "super_admin"}
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            pending = await service.submit_profile(db, TargetProfileSubmission.model_validate(submission()), actor)

        async def review():
            async with sessions() as db:
                try:
                    return await service.review_profile(db, pending["profile"]["id"], TargetProfileReview.model_validate(approval()), actor)
                except HTTPException as error:
                    await db.rollback()
                    return error.status_code

        results = await asyncio.gather(review(), review())
        assert sum(isinstance(result, dict) for result in results) == 1
        assert results.count(409) == 1
        async with sessions() as db:
            audits = (await db.execute(select(AuditLog).where(AuditLog.action == "target_profile_review"))).scalars().all()
            assert len(audits) == 1
    finally:
        await engine.dispose()
