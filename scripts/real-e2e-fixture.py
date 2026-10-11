"""Own a disposable, loopback-only real API acceptance environment.

No dependency overrides, mocked authentication or production configuration is
used. The Node owner creates the marker and random secrets before this starts.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sqlite3
import sys
from pathlib import Path


def runtime_root() -> Path:
    root = Path(os.environ["KST_REAL_E2E_DIR"]).resolve()
    marker = root / ".kst-real-e2e-owned"
    if not marker.is_file() or marker.read_text(encoding="utf-8") != "kst-real-e2e-v1":
        raise RuntimeError("Refusing an environment not created by the real E2E owner")
    if Path(os.environ["DB_PATH"]).resolve() != root / "acceptance.sqlite3":
        raise RuntimeError("Database must belong to this isolated test directory")
    if os.environ.get("APP_ENV") != "test" or os.environ.get("DB_TYPE") != "sqlite":
        raise RuntimeError("Only explicitly isolated SQLite test environments are allowed")
    return root


async def seed(root: Path) -> None:
    if (root / "acceptance.sqlite3").exists():
        raise RuntimeError("Refusing to overwrite an existing database")
    from core.security import hash_password
    from database import async_session_maker, engine, init_db
    from domains.catalog import seed_initial_data
    from models import (
        Agency,
        AuthCode,
        Plan,
        Setting,
        StaffRole,
        StaffStatus,
        StaffUser,
    )
    from sqlalchemy import select

    await init_db()
    await seed_initial_data()
    credentials = {
        "consumer": "E2E-C-" + secrets.token_hex(12),
        "business": "E2E-B-" + secrets.token_hex(12),
        "business_cancel": "E2E-X-" + secrets.token_hex(12),
        "staff_username": "real_e2e_operator",
        "staff_password": secrets.token_urlsafe(32),
        "agent_a_username": "real_e2e_agent_a",
        "agent_a_password": secrets.token_urlsafe(32),
        "agent_b_username": "real_e2e_agent_b",
        "agent_b_password": secrets.token_urlsafe(32),
    }
    async with async_session_maker() as db:
        plans = list((await db.execute(select(Plan))).scalars())
        consumer = next(p for p in plans if p.name.startswith("Y199"))
        business = next(p for p in plans if p.product_type == "business")
        if os.environ.get("KST_REAL_E2E_UI_CATALOG") == "1":
            # Display-only synthetic catalog: never a real-tool acceptance.
            from domains.catalog.seed_service import default_tool_configs

            catalog = [tool for tool in default_tool_configs() if tool.get("capability_key") in {"listing_script", "ad_script"}]
            if len(catalog) != 2:
                raise RuntimeError("UI fixture requires the known two catalog schemas")
            for tool in catalog:
                tool.update(availability="live_beta", supports_demo_single=False, supports_demo_batch=False,
                            supports_live_single=True, supports_live_batch=True, supports_batch=True,
                            status="maintenance", release_status="maintenance", script_status="blocked",
                            capability_tags=["本机界面验收"], preparation_notes=["只核对查找与说明布局，不启动任何任务。"],
                            description="仅用于本机界面验收的不可执行目录；不会启动平台或 Runner。")
            setting = (await db.execute(select(Setting).where(Setting.key == "tool_configs"))).scalar_one()
            setting.value = json.dumps(catalog, ensure_ascii=False)
        for label in ("consumer", "business", "business_cancel"):
            db.add(AuthCode(
                code=credentials[label],
                plan_id=consumer.id if label == "consumer" else business.id,
                max_devices=5,
                seat_limit=5,
                status="unused",
                platform_scope="amazon,aliexpress",
                scene_type="competition",
            ))
        db.add(StaffUser(
            username=credentials["staff_username"],
            display_name="隔离验收运营",
            password_hash=hash_password(credentials["staff_password"]),
            role=StaffRole.SUPER_ADMIN,
            status=StaffStatus.ACTIVE,
            token_version=1,
            force_password_reset=False,
        ))
        # Partners are local acceptance identities, never production accounts.
        for label in ("a", "b"):
            agency = Agency(name=f"隔离验收代理 {label.upper()}", status="active")
            db.add(agency)
            await db.flush()
            credentials[f"agency_{label}_id"] = agency.id
            db.add(StaffUser(
                username=credentials[f"agent_{label}_username"],
                display_name=f"隔离代理 {label.upper()}",
                password_hash=hash_password(credentials[f"agent_{label}_password"]),
                role=StaffRole.AGENT,
                agency_id=agency.id,
                status=StaffStatus.ACTIVE,
                token_version=1,
                force_password_reset=False,
            ))
        if os.environ.get("KST_EXPERIENCE_VISUAL_FIXTURES") == "1":
            # Opt-in synthetic display fixtures. Never read a deployment DB,
            # and do not change the normal critical-flow acceptance seed.
            from datetime import datetime, timedelta
            from models import AgencyCustomer, Order

            await db.flush()
            agent = (await db.execute(select(StaffUser).where(
                StaffUser.username == credentials["agent_a_username"]
            ))).scalar_one()
            for index, expired in enumerate((True, False), start=1):
                customer = AgencyCustomer(
                    agency_id=credentials["agency_a_id"],
                    name=("已到期样例客户" if expired else "待激活样例客户") + " · 较长名称的窄窗口验收",
                    notes="仅本机虚构样例；不是生产客户",
                    created_by_staff_id=agent.id,
                )
                db.add(customer)
                await db.flush()
                order = Order(
                    order_no=f"LOCAL-VISUAL-{index}", agency_id=customer.agency_id,
                    customer_id=customer.id, plan_id=consumer.id,
                    plan_name_snapshot=consumer.name, plan_price_snapshot=consumer.price,
                    plan_duration_days_snapshot=30, amount=consumer.price,
                    status="paid", created_by_staff_id=agent.id,
                )
                db.add(order)
                await db.flush()
                db.add(AuthCode(
                    code="E2E-V-" + secrets.token_hex(12),
                    agency_id=customer.agency_id, customer_id=customer.id,
                    order_id=order.id, plan_id=consumer.id, status="unused",
                    expires_at=datetime.now() + timedelta(days=-1 if expired else 30),
                    max_devices=1, seat_limit=1, platform_scope="amazon",
                ))
        if os.environ.get("KST_ADMIN_FLOW_FIXTURES") == "1":
            # Isolated product-workflow acceptance only. IDs are relational
            # fixtures, never joined by a coincidentally equal customer ID.
            from datetime import datetime, timedelta
            from models import Device, Feedback, User

            for role in (StaffRole.OPERATOR, StaffRole.SUPPORT):
                credentials[f"{role}_username"] = f"local_flow_{role}"
                credentials[f"{role}_password"] = secrets.token_urlsafe(32)
                db.add(StaffUser(
                    username=credentials[f"{role}_username"], display_name=f"隔离验收 {role}",
                    password_hash=hash_password(credentials[f"{role}_password"]),
                    role=role, status=StaffStatus.ACTIVE, token_version=1, force_password_reset=False,
                ))
            auth = AuthCode(code="E2E-F-" + secrets.token_hex(12), plan_id=consumer.id,
                            max_devices=1, seat_limit=1, status="active", platform_scope="amazon",
                            expires_at=datetime.now() + timedelta(days=3))
            db.add(auth)
            await db.flush()
            user = User(name="本机验收客户 · 较长名称", auth_code_id=auth.id,
                        device_id="local-flow-owner", device_name="本机隔离测试设备", total_seats=1)
            db.add(user)
            await db.flush()
            for index in range(2):
                db.add(Device(auth_code_id=auth.id, device_id=f"local-flow-device-{index}",
                              device_name=f"隔离设备 {index + 1}"))
            ticket = Feedback(user_id=user.id, title="本机验收 · 授权与设备求助",
                              content="这是虚构验收问题，需要核对授权与设备。", status="pending", platform_key="amazon")
            db.add(ticket)
            await db.flush()
            ids = {"user_id": user.id, "auth_code_id": auth.id, "ticket_id": ticket.id}
            if os.environ.get("KST_ADMIN_PAGINATION_FIXTURES") == "1":
                # Populate beyond the former first-100 client limit without
                # adding any real customer or near-expiry dashboard task.
                for index in range(105):
                    db.add(AuthCode(code="E2E-P-" + secrets.token_hex(12), plan_id=consumer.id,
                                    max_devices=1, seat_limit=1, status="unused", platform_scope="amazon",
                                    device_name=f"本机分页验收设备-{index:03d}"))
            # The object-level link must work beyond the first paginated page.
            for index in range(25):
                db.add(Feedback(user_id=user.id, title=f"历史验收求助 {index + 1}", content="仅本地历史夹具",
                                status="resolved", platform_key="amazon"))
            db.add(Feedback(user_id=user.id, title="另一平台验收记录", content="用于平台过滤验证",
                            status="pending", platform_key="aliexpress"))
            (root / "admin-flow-ids.json").write_text(json.dumps(ids), encoding="utf-8")
        await db.commit()
    (root / "credentials.json").write_text(json.dumps(credentials), encoding="utf-8")
    await engine.dispose()


def snapshot(root: Path) -> None:
    # Read-only inspection independently verifies the browser's writes. No
    # credentials, raw customer input or user/account identifiers are exported.
    database = sqlite3.connect((root / "acceptance.sqlite3").as_uri() + "?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    queries = {
        "runs": "SELECT status, completed_step_count, total_step_count FROM demo_runs",
        "batches": "SELECT id, status, row_count, queued_count, playing_count, played_count, skipped_count, error_count FROM demo_batches",
        "items": "SELECT batch_id, status, simulated_outcome FROM demo_batch_items",
        "expenses": "SELECT title, amount, status, renewal_id FROM expense_records",
        "occurrences": "SELECT status, expense_id FROM expense_renewal_occurrences",
        "attachments": "SELECT original_name, size_bytes FROM expense_attachments",
        "authorizations": "SELECT status FROM auth_codes WHERE code LIKE 'E2E-%'",
    }
    data: dict[str, object] = {
        key: [dict(row) for row in database.execute(query)] for key, query in queries.items()
    }
    data["live_run_count"] = database.execute("SELECT COUNT(*) FROM run_logs").fetchone()[0]
    data["live_batch_count"] = database.execute("SELECT COUNT(*) FROM automation_batches").fetchone()[0]
    data["device_count"] = database.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
    database.close()
    print(json.dumps(data, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seed", "serve", "snapshot"))
    args = parser.parse_args()
    root = runtime_root()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    if args.action == "seed":
        asyncio.run(seed(root))
    elif args.action == "snapshot":
        snapshot(root)
    else:
        import uvicorn
        from fastapi.staticfiles import StaticFiles
        from main import app

        # Real routes precede static files, giving the browser same-origin API
        # traffic without a reverse-proxy mock or a public backend fallback.
        app.mount("/", StaticFiles(directory=root / "web", html=True), name="e2e-web")
        uvicorn.run(app, host="127.0.0.1", port=int(os.environ["KST_REAL_E2E_PORT"]), access_log=False)


if __name__ == "__main__":
    main()
