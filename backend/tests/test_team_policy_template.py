"""Private preview and purchased-service holds using synthetic fixtures only."""

import json
from datetime import date, datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select

from core.exceptions import ConflictException
from domains.team_ledger.policy_template import latest_policy_template
from domains.team_ledger.service import TeamLedgerService
from models import Agency, Order, OrderStatus, StaffUser
from models.commercial import (
    CommercialOfferVersion,
    CommercialOrderSnapshot,
    CommercialRefundEntitlementReview,
    ServiceFulfillment,
)
from models.team_ledger import TeamLedgerEntry, TeamPolicy, TeamServiceDelivery
from schemas.team_ledger import (
    AllocationInput,
    ConfirmInput,
    MemberInput,
    OwnershipInput,
    PolicyInput,
    PreviewInput,
    ReleaseInput,
    ServiceDeliveryInput,
)
from services.staff_service import create_staff_access_token


@pytest.fixture(autouse=True)
def private_template_config(tmp_path, monkeypatch):
    """Public tests never need or embed an operator's real commercial policy."""
    document = {
        "name": "Synthetic policy fixture",
        "product_skus": ["sample-tool"],
        "items": [
            {"code": "fixture.first", "label": "Synthetic first duty", "group": "Fixture A", "ratio": "0.5"},
            {"code": "fixture.second", "label": "Synthetic second duty", "group": "Fixture A", "ratio": "0.3"},
            {"code": "fixture.delivery", "label": "Synthetic delivery duty", "group": "Fixture B", "ratio": "0.2",
             "service_code": "fixture-internal-duty", "purchased_service_codes": ["appointment"]},
        ],
    }
    source = tmp_path / "operator-policy.json"
    source.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setenv("TEAM_POLICY_TEMPLATE_FILE", str(source))
    return source, document


def test_private_template_validates_supplied_products_and_returns_independent_models(private_template_config):
    _, document = private_template_config
    policy = latest_policy_template()
    groups: dict[str, Decimal] = {}
    for item in policy.items:
        groups[item.group] = groups.get(item.group, Decimal(0)) + item.ratio
    assert groups == {"Fixture A": Decimal(".8"), "Fixture B": Decimal(".2")}
    assert sum(groups.values()) == 1
    assert policy == PolicyInput.model_validate(document)
    assert policy.product_skus == ["sample-tool"]
    assert policy.items[-1].purchased_service_codes == ["appointment"]
    policy.items[0].label = "caller mutation"
    assert latest_policy_template().items[0].label == "Synthetic first duty"


def test_template_defaults_to_private_directory_in_persistent_runtime(tmp_path, monkeypatch, private_template_config):
    _, document = private_template_config
    source = tmp_path / "runtime" / "private" / "team-policy-template.json"
    source.parent.mkdir(parents=True)
    source.write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.delenv("TEAM_POLICY_TEMPLATE_FILE")
    monkeypatch.setenv("TOOLBOX_RUNTIME_DIR", str(tmp_path / "runtime"))
    assert latest_policy_template() == PolicyInput.model_validate(document)


def test_explicit_template_path_overrides_runtime_and_reads_updates(tmp_path, monkeypatch, private_template_config):
    source, document = private_template_config
    monkeypatch.setenv("TOOLBOX_RUNTIME_DIR", str(tmp_path / "unconfigured-runtime"))
    assert latest_policy_template().name == document["name"]
    document["name"] = "Updated synthetic configuration"
    source.write_text(json.dumps(document), encoding="utf-8")
    assert latest_policy_template().name == document["name"]


@pytest.mark.parametrize("failure", ["unconfigured", "missing", "invalid-json", "invalid-model"])
def test_unavailable_template_is_503_without_private_path_or_content(tmp_path, monkeypatch, private_template_config, failure):
    source, _ = private_template_config
    if failure == "unconfigured":
        monkeypatch.delenv("TEAM_POLICY_TEMPLATE_FILE")
        monkeypatch.delenv("TOOLBOX_RUNTIME_DIR", raising=False)
    elif failure == "missing":
        monkeypatch.setenv("TEAM_POLICY_TEMPLATE_FILE", str(tmp_path / "private-secret-missing.json"))
    else:
        source.write_text("PRIVATE-CONTENT-DO-NOT-EXPOSE" if failure == "invalid-json" else '{"name":"PRIVATE-CONTENT-DO-NOT-EXPOSE"}', encoding="utf-8")
    with pytest.raises(HTTPException) as failure_info:
        latest_policy_template()
    assert failure_info.value.status_code == 503
    assert failure_info.value.detail == "分成方案暂不可用，请联系管理员核对配置后重试"
    assert str(tmp_path) not in str(failure_info.value.detail)
    assert "PRIVATE-CONTENT" not in str(failure_info.value.detail)


def test_linked_services_contract_is_optional_unique_and_totals_remain_exact():
    old = PolicyInput(name="Old fixture", product_skus=["sample-tool"], items=[{"code": "old", "label": "Old", "group": "Old", "ratio": "1"}])
    assert old.items[0].purchased_service_codes == []
    changed = old.model_dump(mode="json")
    changed["items"][0]["purchased_service_codes"] = ["appointment", "appointment"]
    with pytest.raises(ValidationError, match="不能重复"):
        PolicyInput.model_validate(changed)
    changed["items"][0]["purchased_service_codes"] = []
    changed["items"][0]["ratio"] = "0.99"
    with pytest.raises(ValidationError, match="精确为 1"):
        PolicyInput.model_validate(changed)


@pytest.mark.asyncio
async def test_missing_private_file_keeps_permission_checks_and_returns_generic_503(client, auth_headers, staff_headers_factory, tmp_path, monkeypatch):
    monkeypatch.setenv("TEAM_POLICY_TEMPLATE_FILE", str(tmp_path / "private-secret-missing.json"))
    assert (await client.get("/api/team-ledger/policy-template")).status_code == 401
    support = await staff_headers_factory("support", "template-unavailable-support")
    assert (await client.get("/api/team-ledger/policy-template", headers=support)).status_code == 403
    response = await client.get("/api/team-ledger/policy-template", headers=auth_headers)
    assert response.status_code == 503
    assert response.json()["message"] == "分成方案暂不可用，请联系管理员核对配置后重试"
    assert str(tmp_path) not in response.text
    assert "private-secret" not in response.text


@pytest.mark.asyncio
async def test_template_requires_super_admin_and_does_not_import_or_change_history(client, auth_headers, staff_headers_factory, db_session):
    assert (await client.get("/api/team-ledger/policy-template")).status_code == 401
    for role in ("operator", "support"):
        headers = await staff_headers_factory(role, f"template-{role}")
        denied = await client.get("/api/team-ledger/policy-template", headers=headers)
        assert denied.status_code == 403
        assert "Synthetic first duty" not in denied.text
    agency = Agency(name="Template permission fixture")
    db_session.add(agency)
    await db_session.flush()
    agent = StaffUser(username="template-agent", display_name="Fixture agent", password_hash="not-a-login",
                      role="agent", agency_id=agency.id, status="active", token_version=1, force_password_reset=False)
    db_session.add(agent)
    await db_session.commit()
    denied = await client.get("/api/team-ledger/policy-template", headers={"Authorization": f"Bearer {create_staff_access_token(agent)}"})
    assert denied.status_code == 403
    old_data = {"name": "Existing active fixture", "product_skus": ["sample-tool"], "items": [{"code": "old", "label": "Old", "group": "Old", "ratio": "1"}]}
    created = await client.post("/api/team-ledger/policies", headers=auth_headers, json=old_data)
    old_id = created.json()["data"]["id"]
    active = await client.post(f"/api/team-ledger/policies/{old_id}/activate", headers=auth_headers, json={"expected_version": 1})
    old_snapshot = active.json()["data"]
    old_order = Order(order_no="unchanged-historical-order", amount=Decimal("199"), status=OrderStatus.PAID,
                      paid_at=datetime(2026, 10, 1), plan_name_snapshot="Original name", delivery_entitlements_snapshot='{"old":true}')
    db_session.add(old_order)
    await db_session.commit()
    for _ in range(2):
        response = await client.get("/api/team-ledger/policy-template", headers=auth_headers)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "private, no-store"
        template = PolicyInput.model_validate(response.json()["data"])
        assert template == latest_policy_template()
    assert await db_session.scalar(select(func.count()).select_from(TeamPolicy)) == 1
    assert await db_session.scalar(select(func.count()).select_from(TeamLedgerEntry)) == 0
    imported = await client.post("/api/team-ledger/policies", headers=auth_headers, json=template.model_dump(mode="json"))
    assert imported.json()["data"]["status"] == "draft"
    assert imported.json()["data"]["id"] != old_id
    policies = (await client.get("/api/team-ledger/policies", headers=auth_headers)).json()["data"]
    assert next(row for row in policies if row["id"] == old_id) == old_snapshot
    await db_session.refresh(old_order)
    assert old_order.amount == Decimal("199")
    assert old_order.plan_name_snapshot == "Original name"
    assert old_order.delivery_entitlements_snapshot == '{"old":true}'


@pytest_asyncio.fixture
async def linked_case(db_session):
    async def create(*, purchased=None, completed=0, create_fulfillment=True):
        purchased = [{"code": "appointment", "count": 3}] if purchased is None else purchased
        staff = StaffUser(username="linked-service-admin", display_name="Fixture admin", password_hash="not-a-login",
                          role="super_admin", status="active", force_password_reset=False)
        db_session.add(staff)
        await db_session.commit()
        actor = {"staff_id": staff.id, "username": staff.username, "role": staff.role}
        service = TeamLedgerService(db_session)
        draft = await service.create_policy(PolicyInput(name="Synthetic linked policy", product_skus=["sample-tool"], items=[{
            "code": "duty", "label": "Duty", "group": "Delivery", "ratio": "1", "service_code": "internal-duty",
            "purchased_service_codes": ["diagnosis", "group-qa", "appointment", "materials-full"],
        }]), actor)
        policy = await service.activate_policy(draft["id"], 1, actor)
        person = await service.create_member(MemberInput(name="Anonymous fixture member"), actor)
        offer = CommercialOfferVersion(sku="sample-tool", version=1, revision=1, status="draft", definition="{}", created_by_staff_id=staff.id)
        source = Order(order_no="linked-service-order", amount=Decimal("100"), refund_amount=Decimal("0"), status=OrderStatus.PAID, paid_at=datetime(2026, 10, 1))
        db_session.add_all([offer, source])
        await db_session.flush()
        snapshot = CommercialOrderSnapshot(order_id=source.id, offer_id=offer.id, sku="sample-tool", offer_version=1, settlement_mode="manual",
                                           snapshot=json.dumps({"definition": {"services": purchased}}))
        db_session.add(snapshot)
        if create_fulfillment:
            for item in purchased:
                db_session.add(ServiceFulfillment(order_id=source.id, service_code=item["code"], total_count=item["count"], completed_count=min(completed, item["count"]), revision=1))
        await db_session.commit()
        await service.save_ownership(OwnershipInput(policy_id=policy["id"], product_sku="sample-tool", item_code="duty",
                                     starts_on=date(2026, 1, 1), members=[{"member_id": person["id"], "weight": "1"}]), actor)
        await service.set_allocation(source.id, AllocationInput(expected_version=0, amount="80", period="2026-10", note="Explicit allocation"), actor)
        await service.service_delivery(source.id, "internal-duty", ServiceDeliveryInput(expected_version=0, evidence="internal-proof", note="Internal duty complete"), actor)
        return service, actor, policy, person, source.id, snapshot.id
    return create


def preview_input(policy):
    return PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10")


@pytest.mark.asyncio
@pytest.mark.parametrize("completed, expected", [(0, "held"), (2, "held"), (3, "due")])
async def test_internal_proof_never_replaces_all_purchased_service_counts(linked_case, completed, expected):
    service, actor, policy, _, order_id, _ = await linked_case(completed=completed)
    preview = await service.preview(preview_input(policy), actor)
    assert preview["total_amount"] == "80.00"
    assert preview["lines_snapshot"][0]["bucket"] == expected
    assert preview["lines_snapshot"][0]["purchased_service_codes"] == ["appointment"]
    assert preview["inputs_snapshot"]["purchased_services"] == [{"order_id": order_id, "services": [{"code": "appointment", "count": 3}]}]


@pytest.mark.asyncio
async def test_missing_fulfillment_stays_held_even_with_fake_internal_proof(linked_case):
    service, actor, policy, _, order_id, _ = await linked_case(create_fulfillment=False)
    service.db.add(TeamServiceDelivery(order_id=order_id, service_code="appointment", completed=True, version=1,
                                       evidence="must-not-replace-counts", note="Synthetic internal proof", completed_by_staff_id=actor["staff_id"]))
    await service.db.commit()
    preview = await service.preview(preview_input(policy), actor)
    assert preview["lines_snapshot"][0]["bucket"] == "held"
    assert "service_unfulfilled" in preview["lines_snapshot"][0]["held_reasons"]


@pytest.mark.asyncio
async def test_unpurchased_services_do_not_create_new_requirements(linked_case):
    service, actor, policy, _, _, _ = await linked_case(purchased=[])
    preview = await service.preview(preview_input(policy), actor)
    assert preview["lines_snapshot"][0]["bucket"] == "due"
    assert preview["lines_snapshot"][0]["purchased_service_codes"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("incomplete", ["diagnosis", "group-qa", "appointment", "materials-full"])
async def test_every_purchased_service_is_required_not_only_the_first_one(linked_case, incomplete):
    purchased = [{"code": code, "count": 3 if code == "appointment" else 1} for code in ("diagnosis", "group-qa", "appointment", "materials-full")]
    service, actor, policy, _, order_id, _ = await linked_case(purchased=purchased, completed=3)
    pending = await service.db.scalar(select(ServiceFulfillment).where(ServiceFulfillment.order_id == order_id, ServiceFulfillment.service_code == incomplete))
    pending.completed_count = 0
    await service.db.commit()
    preview = await service.preview(preview_input(policy), actor)
    assert preview["lines_snapshot"][0]["bucket"] == "held"
    assert set(preview["lines_snapshot"][0]["purchased_service_codes"]) == {item["code"] for item in purchased}


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_snapshot", [{}, {"definition": {}}])
async def test_invalid_purchase_snapshot_is_not_interpreted_as_no_services(linked_case, invalid_snapshot):
    service, actor, policy, _, _, snapshot_id = await linked_case(completed=3)
    snapshot = await service.db.get(CommercialOrderSnapshot, snapshot_id)
    snapshot.snapshot = json.dumps(invalid_snapshot)
    await service.db.commit()
    with pytest.raises(ConflictException, match="购买快照不完整"):
        await service.preview(preview_input(policy), actor)


@pytest.mark.asyncio
async def test_fulfillment_and_purchase_scope_changes_invalidate_old_preview(linked_case):
    service, actor, policy, _, order_id, snapshot_id = await linked_case(completed=2)
    preview = await service.preview(preview_input(policy), actor)
    fulfillment = await service.db.scalar(select(ServiceFulfillment).where(ServiceFulfillment.order_id == order_id))
    fulfillment.completed_count, fulfillment.revision = 3, 2
    await service.db.commit()
    with pytest.raises(ConflictException, match="履约已改变"):
        await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)
    await service.db.rollback()
    preview = await service.preview(preview_input(policy), actor)
    snapshot = await service.db.get(CommercialOrderSnapshot, snapshot_id)
    snapshot.snapshot = json.dumps({"definition": {"services": [{"code": "appointment", "count": 3}, {"code": "diagnosis", "count": 1}]}})
    await service.db.commit()
    with pytest.raises(ConflictException, match="履约已改变"):
        await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)


@pytest.mark.asyncio
@pytest.mark.parametrize("service_limit, reviewed_refund, expected", [(1, "10", True), (0, "10", False), (3, "10", False), (1, "5", False)])
async def test_held_release_rechecks_current_refund_scope_without_internal_bypass(linked_case, service_limit, reviewed_refund, expected):
    service, actor, policy, person, order_id, _ = await linked_case(completed=1)
    preview = await service.preview(preview_input(policy), actor)
    await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)
    original = await service.db.scalar(select(TeamLedgerEntry))
    original_id = original.id
    request = ReleaseInput(member_id=person["id"], amount="80", expected_remaining="80", idempotency_key="linked-release-test", evidence="effective-scope-check", note="Do not bypass purchased service")
    with pytest.raises(ConflictException, match="已购服务"):
        await service.release_held(original_id, request, actor)
    await service.db.rollback()
    source = await service.db.get(Order, order_id)
    source.refund_amount = Decimal("10")
    service.db.add(CommercialRefundEntitlementReview(order_id=order_id, refund_amount_snapshot=Decimal(reviewed_refund),
                   retained_capabilities="[]", service_limits=json.dumps({"appointment": service_limit}), revision=1,
                   reviewed_by_staff_id=actor["staff_id"], evidence_ref="scope-check", reviewed_at=datetime.utcnow()))
    await service.db.commit()
    if expected:
        released = await service.release_held(original_id, request, actor)
        assert released["bucket"] == "due"
        assert released["snapshot"]["purchased_service_codes"] == ["appointment"]
    else:
        with pytest.raises(ConflictException, match="已购服务"):
            await service.release_held(original_id, request, actor)
    original = await service.db.get(TeamLedgerEntry, original_id)
    assert original.amount == Decimal("80")
    assert original.bucket == "held"
