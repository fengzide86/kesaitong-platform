"""Private-ledger regressions with synthetic ratios and anonymous test members."""

import json
from datetime import date, datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import select

from core.exceptions import ConflictException, ValidationException
from domains.team_ledger.service import TeamLedgerService, largest_remainder
from models import Order, OrderStatus, ProfitRecord, StaffUser
from models.commercial import (
    CommercialOfferVersion,
    CommercialOrderSnapshot,
    CommercialRefundEntitlementReview,
    ServiceFulfillment,
)
from models.team_ledger import TeamLedgerEntry, TeamMember, TeamOrderAllocation, TeamPolicy, TeamSettlement
from schemas.team_ledger import (
    AdjustmentInput,
    AllocationInput,
    ConfirmInput,
    MemberInput,
    MemberUpdate,
    OwnershipInput,
    OwnershipUpdate,
    PartialRefundInput,
    PaymentInput,
    PolicyInput,
    PolicyUpdate,
    PreviewInput,
    RefundResolveInput,
    ReleaseInput,
    ServiceDeliveryInput,
)

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def ledger(db_session):
    staff = StaffUser(username="ledger-test", display_name="Ledger tester", password_hash="not-a-login",
                      role="super_admin", status="active", force_password_reset=False)
    db_session.add(staff)
    await db_session.commit()
    actor = {"staff_id": staff.id, "username": staff.username, "role": staff.role}
    return TeamLedgerService(db_session), actor


def policy_input(*, items=None, skus=None):
    return PolicyInput(name="Synthetic test policy", product_skus=skus or ["sample-tool"], items=items or [
        {"code": "build", "label": "Build", "group": "Delivery", "ratio": "0.6"},
        {"code": "sell", "label": "Close", "group": "Delivery", "ratio": "0.4", "method": "closing"},
    ])


async def active_policy(service, actor, **kwargs):
    row = await service.create_policy(policy_input(**kwargs), actor)
    return await service.activate_policy(row["id"], 1, actor)


async def member(service, actor, name="Anonymous member"):
    return await service.create_member(MemberInput(name=name), actor)


async def order(service, *, amount="100.00", sku="sample-tool", refund="0.00", paid=True, commercial=True):
    rows = (await service.db.execute(select(Order.id))).scalars().all()
    row = Order(order_no=f"synthetic-{len(rows) + 1}", amount=Decimal(amount), refund_amount=Decimal(refund),
                status=OrderStatus.PAID if paid else OrderStatus.PENDING,
                paid_at=datetime(2026, 10, 10) if paid else None)
    service.db.add(row)
    await service.db.flush()
    if commercial:
        offer = (await service.db.execute(select(CommercialOfferVersion).where(CommercialOfferVersion.sku == sku))).scalar_one_or_none()
        if not offer:
            offer = CommercialOfferVersion(sku=sku, version=1, revision=1, status="draft", definition="{}",
                                           created_by_staff_id=1)
            service.db.add(offer)
            await service.db.flush()
        service.db.add(CommercialOrderSnapshot(order_id=row.id, offer_id=offer.id, sku=sku, offer_version=1,
                                               settlement_mode="manual", snapshot="{}"))
    await service.db.commit()
    return row


async def allocate(service, actor, source, amount="80.00", **kwargs):
    return await service.set_allocation(source.id, AllocationInput(
        expected_version=kwargs.pop("expected_version", 0), amount=amount, period="2026-10", note="Explicit distribution base",
        **kwargs,
    ), actor)


async def ownership(service, actor, policy, recipient, *, item_code="build", weight="1", **kwargs):
    return await service.save_ownership(OwnershipInput(
        policy_id=policy["id"], item_code=item_code, product_sku="sample-tool", starts_on=date(2026, 1, 1),
        members=[{"member_id": recipient["id"], "weight": weight}], **kwargs,
    ), actor)


async def settle(service, actor, policy):
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    return await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)


async def test_largest_remainder_conserves_every_cent():
    for cents in range(1, 300):
        amount = Decimal(cents) / 100
        shares = largest_remainder(amount, [Decimal("0.33333333"), Decimal("0.33333333"), Decimal("0.33333334")])
        assert sum(shares) == amount
        assert all(value >= 0 and value == value.quantize(Decimal("0.01")) for value in shares)
    assert largest_remainder(Decimal("0.02"), [Decimal(1)] * 3) == [Decimal("0.01"), Decimal("0.01"), Decimal(0)]
    with pytest.raises(ValidationException):
        largest_remainder(Decimal("NaN"), [Decimal(1)])


@pytest.mark.parametrize("cents", [[1, 1], [10001, 10001], [0, 1, 2], [3, 0, 4, 2, 1]])
@pytest.mark.parametrize("ratios", [["0.5", "0.5"], ["0", "0.3", "0.7"], ["0.33333333", "0.33333333", "0.33333334"]])
async def test_rounding_preserves_each_order_base_and_each_policy_pool(cents, ratios):
    bases = [Decimal(value) / 100 for value in cents]
    inputs = {
        "policy": {"items": [{"code": f"item-{index}", "label": "Synthetic", "group": "Synthetic",
                               "ratio": ratio, "method": "closing"} for index, ratio in enumerate(ratios)]},
        "allocations": [{"order_id": index, "amount": str(base), "closing_member_id": 1,
                         "acquisition_member_id": None, "is_repeat_purchase": False} for index, base in enumerate(bases)],
        "orders": [{"id": index, "net": str(base)} for index, base in enumerate(bases)],
        "members": [{"id": 1, "active": True}], "ownerships": [], "fulfillment": [], "internal_delivery": [],
    }
    total, lines = TeamLedgerService._lines(inputs)
    assert total == sum(bases)
    for index, base in enumerate(bases):
        assert sum((Decimal(line["amount"]) for line in lines if line["order_id"] == index), Decimal(0)) == base
    pools = largest_remainder(total, [Decimal(ratio) for ratio in ratios])
    for index, pool in enumerate(pools):
        assert sum((Decimal(line["amount"]) for line in lines if line["item_code"] == f"item-{index}"), Decimal(0)) == pool
    assert TeamLedgerService._lines(inputs) == (total, lines)


@pytest.mark.parametrize("old_rounding_snapshot", [False, True])
async def test_tied_cent_order_can_be_fully_refunded_after_settlement(ledger, old_rounding_snapshot):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "first", "label": "First synthetic item", "group": "Synthetic", "ratio": "0.5"},
        {"code": "second", "label": "Second synthetic item", "group": "Synthetic", "ratio": "0.5"},
    ])
    person = await member(service, actor)
    for code in ("first", "second"):
        await ownership(service, actor, policy, person, item_code=code)
    first = await order(service, amount="0.01")
    second = await order(service, amount="0.01")
    await allocate(service, actor, first, amount="0.01")
    await allocate(service, actor, second, amount="0.01")
    if old_rounding_snapshot:
        preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
        stored = await service.db.get(TeamSettlement, preview["id"])
        # The previous allocator assigned both tied item cents to order one.
        stored.lines_snapshot = json.dumps([{**line, "order_id": first.id} for line in preview["lines_snapshot"]])
        await service.db.commit()
        with pytest.raises(ConflictException, match="分配计算已变化"):
            await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)
        await service.db.rollback()
        assert (await service.db.scalars(select(TeamLedgerEntry))).all() == []
        first = await service.db.get(Order, 1)
        second = await service.db.get(Order, 2)
    result = await settle(service, actor, policy)
    for source in (first, second):
        assert sum((Decimal(line["amount"]) for line in result["lines_snapshot"] if line["order_id"] == source.id), Decimal(0)) == Decimal("0.01")
    entries = (await service.db.scalars(select(TeamLedgerEntry).where(
        TeamLedgerEntry.order_id == second.id, TeamLedgerEntry.kind == "allocation", TeamLedgerEntry.amount > 0,
    ))).all()
    review = await service.partial_refund(second.id, PartialRefundInput(amount="0.01", expected_refunded_total="0.00",
        reason="Synthetic full refund", evidence="synthetic-proof", idempotency_key="tied-cent-refund"), actor)
    resolved = await service.resolve_refund(review["id"], RefundResolveInput(expected_version=1,
        reductions=[{"entry_id": entry.id, "amount": entry.amount, "expected_remaining": entry.amount} for entry in entries],
        evidence="synthetic-proof", note="Reverse only the second order"), actor)
    assert resolved["status"] == "resolved"
    assert (await service.summary())["totals"]["due"] == "0.01"


async def test_policy_rejects_nonconserving_duplicate_and_extra_fields():
    raw = policy_input().model_dump(mode="json")
    raw["items"][0]["ratio"] = "0.7"
    with pytest.raises(ValidationError):
        PolicyInput.model_validate(raw)
    raw = policy_input().model_dump(mode="json")
    raw["items"][1]["code"] = raw["items"][0]["code"]
    with pytest.raises(ValidationError):
        PolicyInput.model_validate(raw)
    with pytest.raises(ValidationError):
        AllocationInput(expected_version=0, amount="1.001", period="2026-10", note="exact cents only")


async def test_policy_import_is_draft_and_active_is_immutable(ledger):
    service, actor = ledger
    row = await service.create_policy(policy_input(), actor)
    assert row["status"] == "draft"
    with pytest.raises(ConflictException):
        await service.preview(PreviewInput(policy_id=row["id"], product_sku="sample-tool", period="2026-10"), actor)
    await service.db.rollback()
    await service.activate_policy(row["id"], 1, actor)
    with pytest.raises(ConflictException):
        await service.update_policy(row["id"], PolicyUpdate(**policy_input().model_dump(), expected_version=2), actor)


async def test_receipt_never_creates_team_income_and_manual_base_is_bounded(ledger):
    service, actor = ledger
    source = await order(service, amount="120.00", refund="20.00")
    assert (await service.summary())["totals"]["due"] == "0.00"
    with pytest.raises(ValidationException):
        await allocate(service, actor, source, amount="100.01")
    await service.db.rollback()
    row = await allocate(service, actor, await service.db.get(Order, 1), amount="73.21")
    assert row["amount"] == "73.21"
    assert (await service.summary())["totals"]["due"] == "0.00"


@pytest.mark.parametrize("paid,commercial", [(False, True), (True, False)])
async def test_unpaid_or_legacy_order_cannot_enter_new_ledger(ledger, paid, commercial):
    service, actor = ledger
    source = await order(service, paid=paid, commercial=commercial)
    with pytest.raises(ConflictException):
        await allocate(service, actor, source)
    assert (await service.db.execute(select(ProfitRecord))).scalars().all() == []


async def test_allocation_versions_and_preview_fingerprint_prevent_stale_confirm(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor)
    source = await order(service)
    await allocate(service, actor, source)
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    await allocate(service, actor, source, amount="79.00", expected_version=1)
    with pytest.raises(ConflictException):
        await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)
    await service.db.rollback()
    with pytest.raises(ConflictException):
        await allocate(service, actor, await service.db.get(Order, 1), expected_version=1)


async def test_unassigned_incomplete_and_disputed_shares_are_held(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor)
    person = await member(service, actor)
    source = await order(service)
    await allocate(service, actor, source)
    own = await ownership(service, actor, policy, person, weight="0.5")
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    assert all(line["bucket"] == "held" for line in preview["lines_snapshot"])
    assert "incomplete_ownership" in preview["lines_snapshot"][0]["held_reasons"]
    update = OwnershipUpdate(policy_id=policy["id"], item_code="build", product_sku="sample-tool", starts_on=date(2026, 1, 1),
                             members=[{"member_id": person["id"], "weight": "1"}], disputed=True, expected_version=1)
    await service.save_ownership(update, actor, own["id"])
    result = await settle(service, actor, policy)
    assert result["total_amount"] == "80.00"
    assert (await service.summary())["totals"] == {"due": "0.00", "held": "80.00", "paid": "0.00", "unpaid": "0.00"}


async def test_complete_ownership_and_attribution_sum_to_confirmed_base(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor)
    build = await member(service, actor, "Builder")
    close = await member(service, actor, "Closer")
    await ownership(service, actor, policy, build)
    source = await order(service)
    await allocate(service, actor, source, amount="79.99", closing_member_id=close["id"])
    result = await settle(service, actor, policy)
    assert result["status"] == "confirmed"
    summary = await service.summary()
    assert summary["totals"]["due"] == "79.99"
    assert summary["members"][0]["due"] == "47.99"
    assert summary["members"][1]["due"] == "32.00"
    with pytest.raises(ConflictException):
        await allocate(service, actor, source, amount="75.00", expected_version=2)


async def test_attribution_uses_product_period_net_receipts_and_repeat_is_not_acquisition(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "lead", "label": "Lead", "group": "Synthetic", "ratio": "1", "method": "acquisition"},
    ])
    one = await member(service, actor, "One")
    two = await member(service, actor, "Two")
    first = await order(service, amount="60.00")
    await allocate(service, actor, first, amount="10.00", acquisition_member_id=one["id"])
    second = await order(service, amount="40.00")
    await allocate(service, actor, second, amount="10.00", acquisition_member_id=two["id"], is_repeat_purchase=True)
    await settle(service, actor, policy)
    summary = await service.summary()
    assert summary["members"][0]["due"] == "20.00"
    assert summary["members"][1]["due"] == "0.00"
    assert summary["totals"]["held"] == "0.00"


async def test_ownership_dates_cannot_overlap_and_ended_scope_does_not_apply(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor)
    person = await member(service, actor)
    await ownership(service, actor, policy, person, ends_on=date(2026, 9, 30))
    with pytest.raises(ConflictException):
        await ownership(service, actor, policy, person)
    await service.db.rollback()
    source = await order(service)
    await allocate(service, actor, source, closing_member_id=person["id"])
    result = await settle(service, actor, policy)
    assert result["lines_snapshot"][0]["held_reasons"] == ["unassigned"]


async def test_service_hold_requires_fulfillment_then_releases_append_only(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "support", "label": "Support", "group": "Synthetic", "ratio": "1", "service_code": "test-service"},
    ])
    person = await member(service, actor)
    await ownership(service, actor, policy, person, item_code="support")
    source = await order(service)
    fulfillment = ServiceFulfillment(order_id=source.id, service_code="test-service", total_count=2, completed_count=0, revision=1)
    service.db.add(fulfillment)
    await service.db.commit()
    await allocate(service, actor, source)
    await settle(service, actor, policy)
    entry = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    entry_id = entry.id
    request = ReleaseInput(member_id=person["id"], amount="80.00", expected_remaining="80.00",
                           idempotency_key="release-test-1", evidence="local-record-1", note="Confirmed service completion")
    with pytest.raises(ConflictException):
        await service.release_held(entry_id, request, actor)
    await service.db.rollback()
    fulfillment = (await service.db.execute(select(ServiceFulfillment))).scalar_one()
    fulfillment.completed_count, fulfillment.revision = 2, 2
    await service.db.commit()
    result = await service.release_held(entry_id, request, actor)
    assert result["bucket"] == "due"
    assert (await service.summary())["totals"]["held"] == "0.00"
    assert (await service.db.get(TeamLedgerEntry, entry_id)).amount == Decimal("80.00")
    repeated = await service.release_held(entry_id, request, actor)
    assert repeated["id"] == result["id"]


async def confirmed_due(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[{"code": "build", "label": "Build", "group": "Synthetic", "ratio": "1"}])
    person = await member(service, actor)
    await ownership(service, actor, policy, person)
    source = await order(service)
    await allocate(service, actor, source)
    await settle(service, actor, policy)
    return service, actor, source, person


async def test_payments_are_bounded_versioned_idempotent_records_only(ledger):
    service, actor, source, person = await confirmed_due(ledger)
    data = PaymentInput(member_id=person["id"], amount="30.00", expected_ledger_version=2,
                        idempotency_key="payment-test-1", evidence="external-receipt-1", note="Recorded external payment")
    result = await service.payment(data, actor)
    assert result["kind"] == "payment"
    repeated = await service.payment(data, actor)
    assert repeated["id"] == result["id"]
    await service.db.rollback()
    data.idempotency_key = "payment-test-2"
    with pytest.raises(ConflictException):
        await service.payment(data, actor)
    await service.db.rollback()
    data.expected_ledger_version, data.amount = 3, Decimal("50.01")
    with pytest.raises(ValidationException):
        await service.payment(data, actor)
    assert (await service.summary())["totals"]["unpaid"] == "50.00"


async def test_refund_blocks_payment_and_appends_explicit_adjustment_without_overwriting_paid(ledger):
    service, actor, source, person = await confirmed_due(ledger)
    payment = PaymentInput(member_id=person["id"], amount="70.00", expected_ledger_version=2,
                           idempotency_key="refund-payment-1", evidence="external-receipt-2", note="Recorded external payment")
    await service.payment(payment, actor)
    source.refund_amount = Decimal("50.00")
    review = await service.record_refund(source, "Specific item refund", actor)
    review_id = review.id
    await service.db.commit()
    blocked = PaymentInput(member_id=person["id"], amount="1.00", expected_ledger_version=3,
                           idempotency_key="refund-payment-2", evidence="external-receipt-3", note="Must block")
    with pytest.raises(ConflictException):
        await service.payment(blocked, actor)
    await service.db.rollback()
    original = (await service.db.execute(select(TeamLedgerEntry).where(TeamLedgerEntry.kind == "allocation"))).scalar_one()
    original_id = original.id
    with pytest.raises(ValidationException):
        await service.resolve_refund(review_id, RefundResolveInput(expected_version=1,
            reductions=[{"entry_id": original_id, "amount": "20.00", "expected_remaining": "80.00"}], evidence="refund-item-record", note="Insufficient reduction"), actor)
    await service.db.rollback()
    await service.resolve_refund(review_id, RefundResolveInput(expected_version=1,
        reductions=[{"entry_id": original_id, "amount": "30.00", "expected_remaining": "80.00"}], evidence="refund-item-record", note="Only corresponding scope reduced"), actor)
    summary = await service.summary()
    assert summary["totals"] == {"due": "50.00", "held": "0.00", "paid": "70.00", "unpaid": "-20.00"}
    assert (await service.db.get(TeamLedgerEntry, original_id)).amount == Decimal("80.00")
    adjustment = (await service.db.execute(select(TeamLedgerEntry).where(TeamLedgerEntry.kind == "refund"))).scalar_one()
    assert adjustment.source_entry_id == original_id
    assert json.loads(adjustment.snapshot)["review_id"] == review_id


async def test_member_deactivation_invalidates_preview(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor)
    person = await member(service, actor)
    await ownership(service, actor, policy, person)
    source = await order(service)
    await allocate(service, actor, source)
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    await service.update_member(person["id"], MemberUpdate(name=person["name"], active=False, expected_version=1), actor)
    with pytest.raises(ConflictException):
        await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)


async def test_same_policy_applies_multiple_products_without_special_case(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, skus=["sample-tool", "sample-guided"])
    first = await order(service, sku="sample-tool")
    second = await order(service, sku="sample-guided")
    await allocate(service, actor, first)
    await allocate(service, actor, second)
    one = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    two = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-guided", period="2026-10"), actor)
    assert one["inputs_snapshot"]["policy"]["items"] == two["inputs_snapshot"]["policy"]["items"]
    assert sum(Decimal(line["amount"]) for line in two["lines_snapshot"]) == Decimal("80.00")


async def test_no_internal_policy_seed(ledger):
    service, _ = ledger
    assert (await service.db.execute(select(TeamPolicy))).scalars().all() == []
    assert (await service.db.execute(select(TeamMember))).scalars().all() == []
    assert (await service.db.execute(select(TeamOrderAllocation))).scalars().all() == []


async def test_partial_refund_is_idempotent_bounded_and_keeps_paid_until_full(ledger):
    service, actor = ledger
    source = await order(service)
    request = PartialRefundInput(amount="20.00", expected_refunded_total="0.00", reason="One service refunded",
                                 evidence="refund-proof-1", idempotency_key="partial-test-1")
    first = await service.partial_refund(source.id, request, actor)
    repeated = await service.partial_refund(source.id, request, actor)
    assert first["id"] == repeated["id"]
    assert source.status == OrderStatus.PAID
    assert source.refund_amount == Decimal("20.00")
    await service.db.rollback()
    with pytest.raises(ConflictException):
        await service.partial_refund(1, request.model_copy(update={"idempotency_key": "partial-test-2"}), actor)
    await service.db.rollback()
    with pytest.raises(ValidationException):
        await service.partial_refund(1, request.model_copy(update={"expected_refunded_total": Decimal("20.00"),
                                     "amount": Decimal("80.01"), "idempotency_key": "partial-test-3"}), actor)
    await service.db.rollback()
    await service.partial_refund(1, request.model_copy(update={"expected_refunded_total": Decimal("20.00"),
                                 "amount": Decimal("80.00"), "idempotency_key": "partial-test-4"}), actor)
    source = await service.db.get(Order, 1)
    assert source.status == OrderStatus.REFUNDED
    assert source.refund_amount == Decimal("100.00")


async def test_partial_refund_does_not_silently_reverse_agency_commission(ledger):
    service, actor = ledger
    source = await order(service)
    source.agency_id = 123
    await service.db.commit()
    with pytest.raises(ConflictException, match="独立佣金"):
        await service.partial_refund(source.id, PartialRefundInput(amount="1.00", expected_refunded_total="0.00",
            reason="Synthetic", evidence="proof", idempotency_key="agency-refund-1"), actor)
    assert source.refund_amount == Decimal("0.00")


async def test_full_refund_before_settlement_allows_zeroing_unsettled_base(ledger):
    service, actor = ledger
    source = await order(service)
    await allocate(service, actor, source)
    review = await service.partial_refund(source.id, PartialRefundInput(amount="100.00", expected_refunded_total="0.00",
        reason="Full refund before settlement", evidence="proof", idempotency_key="pre-settlement-refund"), actor)
    await allocate(service, actor, source, amount="0.00", expected_version=1)
    result = await service.resolve_refund(review["id"], RefundResolveInput(expected_version=1, reductions=[],
        note="No income was confirmed", evidence="proof"), actor)
    assert result["status"] == "resolved"
    assert (await service.summary())["totals"]["due"] == "0.00"


async def test_balanced_adjustment_preserves_base_and_cannot_bypass_service_gate(ledger):
    service, actor, source, first = await confirmed_due(ledger)
    second = await member(service, actor, "Other anonymous member")
    original = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    original_id = original.id
    data = AdjustmentInput(amount="20.00", expected_remaining="80.00", target_member_id=second["id"],
                           target_bucket="due", evidence="ownership-review-1", note="Correct responsibility",
                           idempotency_key="ownership-adjust-1")
    result = await service.adjustment(original.id, data, actor)
    assert result["kind"] == "adjustment"
    summary = await service.summary()
    assert summary["totals"]["due"] == "80.00"
    assert summary["members"][0]["due"] == "60.00"
    assert summary["members"][1]["due"] == "20.00"
    balance = await service.entry_balance(original.id)
    assert balance["remaining"] == "60.00"
    await service.db.rollback()
    with pytest.raises(ConflictException):
        await service.adjustment(original_id, data.model_copy(update={"idempotency_key": "ownership-adjust-2"}), actor)


async def test_internal_duty_proof_does_not_fabricate_purchased_service_or_bypass_paid_service(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "duty", "label": "Internal duty", "group": "Synthetic", "ratio": "1", "service_code": "internal-duty"},
    ])
    person = await member(service, actor)
    await ownership(service, actor, policy, person, item_code="duty")
    source = await order(service)
    await allocate(service, actor, source)
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    assert preview["lines_snapshot"][0]["bucket"] == "held"
    proof = ServiceDeliveryInput(expected_version=0, evidence="onboarding-ticket", note="Completed internal duty")
    await service.service_delivery(source.id, "internal-duty", proof, actor)
    assert (await service.db.execute(select(ServiceFulfillment))).scalars().all() == []
    with pytest.raises(ConflictException):
        await service.confirm(preview["id"], ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"]), actor)
    await service.db.rollback()
    service.db.add(ServiceFulfillment(order_id=1, service_code="internal-duty", total_count=1, completed_count=0, revision=1))
    await service.db.commit()
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    assert preview["lines_snapshot"][0]["bucket"] == "held"
    with pytest.raises(ConflictException, match="已购服务"):
        await service.service_delivery(1, "internal-duty", proof.model_copy(update={"expected_version": 1}), actor)


@pytest.mark.parametrize(("required_count", "reviewed_refund", "can_release"), [
    (1, "10.00", True), (0, "10.00", False), (3, "10.00", False), (1, "5.00", False),
])
async def test_service_release_requires_current_rights_review_and_separate_cash_review(
    ledger, required_count, reviewed_refund, can_release,
):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "paid-duty", "label": "Synthetic service", "group": "Test", "ratio": "1", "service_code": "appointment"},
    ])
    person = await member(service, actor)
    await ownership(service, actor, policy, person, item_code="paid-duty")
    source = await order(service)
    source_id = source.id
    service.db.add(ServiceFulfillment(order_id=source_id, service_code="appointment", total_count=3,
                                      completed_count=1, minutes_per_unit=30, revision=1))
    await service.db.commit()
    await allocate(service, actor, source)
    await settle(service, actor, policy)
    entry_id = (await service.db.execute(select(TeamLedgerEntry.id))).scalar_one()
    review = await service.partial_refund(source_id, PartialRefundInput(amount="10.00", expected_refunded_total="0.00",
        reason="Cancel unperformed sessions", evidence="refund-proof", idempotency_key="service-refund"), actor)
    service.db.add(CommercialRefundEntitlementReview(order_id=source_id,
        refund_amount_snapshot=Decimal(reviewed_refund), retained_capabilities="[]",
        service_limits=json.dumps({"appointment": required_count}), revision=1,
        reviewed_by_staff_id=actor["staff_id"], evidence_ref="rights-review-proof", reviewed_at=datetime.utcnow()))
    await service.db.commit()
    request = ReleaseInput(member_id=person["id"], amount="80.00", expected_remaining="80.00",
        evidence="performed-session-proof", note="Release only the performed and retained work", idempotency_key="service-release")
    with pytest.raises(ConflictException, match="退款待核对"):
        await service.release_held(entry_id, request, actor)
    await service.db.rollback()
    await service.resolve_refund(review["id"], RefundResolveInput(expected_version=1, reductions=[],
        evidence="cash-review-proof", note="Explicit base remains below net receipt"), actor)
    if can_release:
        await service.release_held(entry_id, request, actor)
        assert (await service.summary())["totals"]["due"] == "80.00"
    else:
        with pytest.raises(ConflictException, match="尚未全部履约"):
            await service.release_held(entry_id, request, actor)
        assert (await service.summary())["totals"]["held"] == "80.00"


async def test_refund_cannot_target_other_order_or_stale_line_balance(ledger):
    service, actor, source, person = await confirmed_due(ledger)
    original = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    source_id, entry_id = source.id, original.id
    review = await service.partial_refund(source_id, PartialRefundInput(amount="10.00", expected_refunded_total="0.00",
        reason="Partial", evidence="proof", idempotency_key="scoped-refund-1"), actor)
    with pytest.raises(ConflictException, match="余额"):
        await service.resolve_refund(review["id"], RefundResolveInput(expected_version=1,
            reductions=[{"entry_id": entry_id, "amount": "1.00", "expected_remaining": "79.00"}],
            note="Stale preview", evidence="proof"), actor)
    await service.db.rollback()
    await service.resolve_refund(review["id"], RefundResolveInput(expected_version=1, reductions=[],
        note="Explicit base still below net receipt", evidence="proof"), actor)
    assert (await service.summary())["totals"]["due"] == "80.00"


async def test_http_permissions_and_typed_policy_response(client, auth_headers, staff_headers_factory):
    no_auth = await client.get("/api/team-ledger/policies")
    assert no_auth.status_code == 401
    support = await staff_headers_factory("support", "no-ledger-support")
    denied = await client.get("/api/team-ledger/summary", headers=support)
    assert denied.status_code == 403
    operator = await staff_headers_factory("operator", "ledger-operator")
    allowed = await client.get("/api/team-ledger/summary", headers=operator)
    assert allowed.status_code == 200
    denied_create = await client.post("/api/team-ledger/policies", headers=operator, json=policy_input().model_dump(mode="json"))
    assert denied_create.status_code == 403
    created = await client.post("/api/team-ledger/policies", headers=auth_headers, json=policy_input().model_dump(mode="json"))
    assert created.status_code == 200, created.text
    assert created.json()["data"]["status"] == "draft"
    assert created.json()["data"]["items"][0]["ratio"] == "0.6"
    from main import app
    spec = app.openapi()
    response = spec["paths"]["/api/team-ledger/entries/{identity}/balance"]["get"]["responses"]["200"]
    assert "$ref" in response["content"]["application/json"]["schema"]


async def test_two_sessions_cannot_confirm_the_same_period_twice(ledger):
    from sqlalchemy.ext.asyncio import AsyncSession

    service, actor = ledger
    policy = await active_policy(service, actor)
    source = await order(service)
    await allocate(service, actor, source)
    preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)
    request = ConfirmInput(expected_version=1, fingerprint=preview["fingerprint"])
    async with AsyncSession(service.db.bind, expire_on_commit=False) as stale_session:
        # Establish a stale read before the first session confirms.
        from models.team_ledger import TeamSettlement
        cached = await stale_session.get(TeamSettlement, preview["id"])
        assert cached.version == 1
        await service.confirm(preview["id"], request, actor)
        with pytest.raises(ConflictException):
            await TeamLedgerService(stale_session).confirm(preview["id"], request, actor)
        await stale_session.rollback()
    entries = (await service.db.execute(select(TeamLedgerEntry))).scalars().all()
    assert sum(entry.amount for entry in entries) == Decimal("80.00")


async def test_concurrent_confirm_on_independent_connections_is_exactly_once(tmp_path):
    import asyncio

    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    from models.base import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'ledger-concurrency.db').as_posix()}",
                                 connect_args={"timeout": 10})
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False, autoflush=False) as session:
            staff = StaffUser(username="concurrency", display_name="Test", password_hash="not-a-login",
                              role="super_admin", status="active", force_password_reset=False)
            session.add(staff)
            await session.commit()
            actor = {"staff_id": staff.id, "username": staff.username, "role": staff.role}
            service = TeamLedgerService(session)
            policy = await active_policy(service, actor)
            source = await order(service)
            await allocate(service, actor, source)
            preview = await service.preview(PreviewInput(policy_id=policy["id"], product_sku="sample-tool", period="2026-10"), actor)

        async def confirm_once():
            async with AsyncSession(engine, expire_on_commit=False, autoflush=False) as session:
                try:
                    return await TeamLedgerService(session).confirm(preview["id"], ConfirmInput(
                        expected_version=1, fingerprint=preview["fingerprint"]), actor)
                except ConflictException as error:
                    await session.rollback()
                    return error

        results = await asyncio.gather(confirm_once(), confirm_once())
        assert sum(isinstance(result, dict) for result in results) == 1
        assert sum(isinstance(result, ConflictException) for result in results) == 1
        async with AsyncSession(engine) as session:
            entries = (await session.execute(select(TeamLedgerEntry))).scalars().all()
            assert sum(entry.amount for entry in entries) == Decimal("80.00")
    finally:
        await engine.dispose()


async def test_mixed_acquisition_excludes_repeat_and_holds_missing_first_purchase(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "lead", "label": "Lead", "group": "Synthetic", "ratio": "1", "method": "acquisition"},
    ])
    person = await member(service, actor)
    first = await order(service, amount="60.00")
    await allocate(service, actor, first, amount="30.00", acquisition_member_id=person["id"])
    missing = await order(service, amount="20.00")
    await allocate(service, actor, missing, amount="20.00")
    repeat = await order(service, amount="20.00")
    await allocate(service, actor, repeat, amount="10.00", acquisition_member_id=person["id"], is_repeat_purchase=True)
    await settle(service, actor, policy)
    summary = await service.summary()
    assert summary["totals"]["due"] == "45.00"
    assert summary["totals"]["held"] == "15.00"


async def test_only_repeat_period_holds_entire_acquisition_pool_and_cannot_release_as_new_lead(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "lead", "label": "Lead", "group": "Synthetic", "ratio": "1", "method": "acquisition"},
    ])
    person = await member(service, actor)
    source = await order(service)
    await allocate(service, actor, source, acquisition_member_id=person["id"], is_repeat_purchase=True)
    await settle(service, actor, policy)
    entry = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    assert (await service.summary())["totals"]["held"] == "80.00"
    with pytest.raises(ConflictException, match="复购"):
        await service.release_held(entry.id, ReleaseInput(member_id=person["id"], amount="80.00", expected_remaining="80.00",
            idempotency_key="repeat-release-denied", note="Not a new lead", evidence="proof"), actor)


async def test_incomplete_ownership_cannot_be_bypassed_by_held_release(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "build", "label": "Build", "group": "Synthetic", "ratio": "1"},
    ])
    first = await member(service, actor)
    second = await member(service, actor, "Second anonymous member")
    source = await order(service)
    await allocate(service, actor, source)
    await settle(service, actor, policy)
    entry = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    entry_id = entry.id
    release = ReleaseInput(member_id=first["id"], amount="80.00", expected_remaining="80.00",
                           note="Explicit evidence alone is insufficient", evidence="review", idempotency_key="unassigned-release")
    with pytest.raises(ConflictException, match="补齐"):
        await service.release_held(entry_id, release, actor)
    await service.db.rollback()
    await service.save_ownership(OwnershipInput(policy_id=policy["id"], item_code="build", product_sku="sample-tool",
        starts_on=date(2026, 1, 1), members=[{"member_id": first["id"], "weight": "0.5"},
                                         {"member_id": second["id"], "weight": "0.5"}]), actor)
    with pytest.raises(ValidationException, match="份额"):
        await service.release_held(entry_id, release, actor)
    await service.db.rollback()
    await service.release_held(entry_id, release.model_copy(update={"amount": Decimal("40.00")}), actor)
    await service.release_held(entry_id, release.model_copy(update={"member_id": second["id"], "amount": Decimal("40.00"),
        "expected_remaining": Decimal("40.00"), "idempotency_key": "unassigned-second-release"}), actor)
    assert (await service.summary())["totals"]["due"] == "80.00"


@pytest.mark.parametrize("held_reason", ["unassigned", "incomplete_ownership", "disputed", "no_new_acquisition"])
async def test_held_adjustment_keeps_original_release_gate(ledger, held_reason):
    service, actor = ledger
    repeat = held_reason == "no_new_acquisition"
    policy = await active_policy(service, actor, items=[
        {"code": "build", "label": "Build", "group": "Synthetic", "ratio": "1",
         "method": "acquisition" if repeat else "fixed"},
    ])
    person = await member(service, actor)
    if held_reason in ("incomplete_ownership", "disputed"):
        await ownership(service, actor, policy, person,
                        weight="0.5" if held_reason == "incomplete_ownership" else "1",
                        disputed=held_reason == "disputed")
    source = await order(service)
    await allocate(service, actor, source, acquisition_member_id=person["id"], is_repeat_purchase=repeat)
    await settle(service, actor, policy)
    original = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    adjusted = await service.adjustment(original.id, AdjustmentInput(
        amount="80.00", expected_remaining="80.00", target_bucket="held", target_member_id=person["id"],
        note="Assign without resolving original restriction", evidence="synthetic-proof",
        idempotency_key="held-gate-adjustment"), actor)
    assert held_reason in adjusted["snapshot"]["held_reasons"]
    with pytest.raises(ConflictException, match="复购" if repeat else "补齐"):
        await service.release_held(adjusted["id"], ReleaseInput(
            member_id=person["id"], amount="80.00", expected_remaining="80.00", note="Must retain original gate",
            evidence="synthetic-proof", idempotency_key="held-gate-release"), actor)
    summary = await service.summary()
    assert summary["totals"]["held"] == "80.00"
    assert summary["totals"]["due"] == "0.00"


async def test_held_adjustment_cannot_change_original_service_owner(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "build", "label": "Build", "group": "Synthetic", "ratio": "1", "service_code": "review"},
    ])
    first = await member(service, actor)
    second = await member(service, actor, "Second anonymous member")
    await ownership(service, actor, policy, first)
    source = await order(service)
    source_id = source.id
    await allocate(service, actor, source)
    await settle(service, actor, policy)
    original = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    adjusted = await service.adjustment(original.id, AdjustmentInput(
        amount="80.00", expected_remaining="80.00", target_bucket="held", target_member_id=second["id"],
        note="Change held owner", evidence="synthetic-proof", idempotency_key="held-owner-adjustment"), actor)
    release = ReleaseInput(member_id=second["id"], amount="80.00", expected_remaining="80.00",
                           note="Must retain delivery and owner gates", evidence="synthetic-proof",
                           idempotency_key="held-owner-release")
    with pytest.raises(ConflictException, match="履约"):
        await service.release_held(adjusted["id"], release, actor)
    await service.db.rollback()
    await service.service_delivery(source_id, "review", ServiceDeliveryInput(
        expected_version=0, evidence="actual-internal-review", note="Synthetic internal delivery complete"), actor)
    with pytest.raises(ConflictException, match="承担人"):
        await service.release_held(adjusted["id"], release, actor)
    assert (await service.summary())["totals"]["due"] == "0.00"


async def test_held_adjustment_chain_shares_original_partial_release_allowance(ledger):
    service, actor = ledger
    policy = await active_policy(service, actor, items=[
        {"code": "build", "label": "Build", "group": "Synthetic", "ratio": "1"},
    ])
    first = await member(service, actor)
    second = await member(service, actor, "Second anonymous member")
    source = await order(service)
    await allocate(service, actor, source)
    await settle(service, actor, policy)
    original = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    original_id = original.id
    await service.save_ownership(OwnershipInput(
        policy_id=policy["id"], item_code="build", product_sku="sample-tool", starts_on=date(2026, 1, 1),
        members=[{"member_id": first["id"], "weight": "0.5"}, {"member_id": second["id"], "weight": "0.5"}]), actor)
    await service.release_held(original_id, ReleaseInput(
        member_id=first["id"], amount="20.00", expected_remaining="80.00", note="Partial first share",
        evidence="synthetic-proof", idempotency_key="chain-release-first"), actor)
    child = await service.adjustment(original_id, AdjustmentInput(
        amount="60.00", expected_remaining="60.00", target_bucket="held", target_member_id=first["id"],
        note="Split remainder", evidence="synthetic-proof", idempotency_key="chain-adjust-first"), actor)
    await service.release_held(child["id"], ReleaseInput(
        member_id=first["id"], amount="20.00", expected_remaining="60.00", note="Finish first original share",
        evidence="synthetic-proof", idempotency_key="chain-release-second"), actor)
    for index, recipient in enumerate((second, first)):
        child = await service.adjustment(child["id"], AdjustmentInput(
            amount="40.00", expected_remaining="40.00", target_bucket="held", target_member_id=recipient["id"],
            note="Move held remainder", evidence="synthetic-proof", idempotency_key=f"chain-move-{index}"), actor)
    with pytest.raises(ValidationException, match="份额"):
        await service.release_held(child["id"], ReleaseInput(
            member_id=first["id"], amount="0.01", expected_remaining="40.00", note="Cannot reset original allowance",
            evidence="synthetic-proof", idempotency_key="chain-over-release"), actor)
    await service.db.rollback()
    child = await service.adjustment(child["id"], AdjustmentInput(
        amount="40.00", expected_remaining="40.00", target_bucket="held", target_member_id=second["id"],
        note="Release remaining second share", evidence="synthetic-proof", idempotency_key="chain-final-adjust"), actor)
    await service.release_held(child["id"], ReleaseInput(
        member_id=second["id"], amount="40.00", expected_remaining="40.00", note="Original second share remains available",
        evidence="synthetic-proof", idempotency_key="chain-final-release"), actor)
    summary = await service.summary()
    assert summary["totals"]["due"] == "80.00"
    assert summary["totals"]["held"] == "0.00"
    assert [row["due"] for row in summary["members"]] == ["40.00", "40.00"]


async def test_recorded_ledger_entry_rejects_orm_rewrite(ledger):
    service, _, _, _ = await confirmed_due(ledger)
    entry = (await service.db.execute(select(TeamLedgerEntry))).scalar_one()
    entry.amount = Decimal("1.00")
    with pytest.raises(ConflictException, match="不可覆盖"):
        await service.db.flush()
    await service.db.rollback()
