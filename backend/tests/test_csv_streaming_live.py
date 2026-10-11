"""Real HTTP CSV regression; the child never loads the limiter-disabling conftest."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import secrets
import socket
import subprocess
import sys
import tempfile
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
@pytest.mark.parametrize("inject_headers", [False, True])
@pytest.mark.parametrize("ending", ["body", "pathsend", "failure"])
async def test_rate_limit_middleware_preserves_stream_events(monkeypatch, inject_headers, ending):
    from core import rate_limit

    injections = []
    sentinel = RuntimeError("intentional downstream exception")

    def inject(headers, limit):
        injections.append(limit)
        headers["X-RateLimit-Test"] = "60"

    application_limiter = SimpleNamespace(enabled=True, _inject_asgi_headers=inject)
    application = SimpleNamespace(state=SimpleNamespace(limiter=application_limiter), routes=[])
    start = {"type": "http.response.start", "status": 200, "headers": []}
    messages = [start, {"type": "http.response.body", "body": b"first", "more_body": True}]
    if ending == "body":
        messages += [{"type": "http.response.body", "body": b"second", "more_body": True},
                     {"type": "http.response.body", "body": b"", "more_body": False}]
    elif ending == "pathsend":
        # A pathsend normally follows start directly; preserve its extension
        # event instead of silently dropping it as the upstream responder did.
        messages = [start, {"type": "http.response.pathsend", "path": "fixture.csv"}]

    async def checks(_limiter, request, _handler, _app):
        request.state.view_rate_limit = "fixture-limit"
        return None, inject_headers

    async def downstream(scope, receive, send):
        for message in messages:
            await send(message)
        if ending == "failure":
            raise sentinel

    async def receive():
        return {"type": "http.disconnect"}

    received = []

    async def send(message):
        received.append(message)

    monkeypatch.setattr(rate_limit, "_find_route_handler", lambda *_: object())
    monkeypatch.setattr(rate_limit, "_should_exempt", lambda *_: False)
    monkeypatch.setattr(rate_limit, "async_check_limits", checks)
    middleware = rate_limit.ApplicationRateLimitMiddleware(downstream)
    if ending == "failure":
        with pytest.raises(RuntimeError) as failure:
            await middleware({"type": "http", "app": application}, receive, send)
        assert failure.value is sentinel
    else:
        await middleware({"type": "http", "app": application}, receive, send)
    assert len(received) == len(messages)
    assert all(actual is original for actual, original in zip(received, messages, strict=True))
    assert sum(message["type"] == "http.response.start" for message in received) == 1
    assert injections == (["fixture-limit"] if inject_headers else [])


@pytest.mark.asyncio
@pytest.mark.parametrize("scope_type", ["lifespan", "websocket"])
async def test_rate_limit_middleware_passes_non_http_through(scope_type):
    from core.rate_limit import ApplicationRateLimitMiddleware

    scope = {"type": scope_type}
    sent = []
    event = {"type": f"{scope_type}.fixture"}

    async def receive():
        return event

    async def send(message):
        sent.append(message)

    async def downstream(actual_scope, actual_receive, actual_send):
        assert actual_scope is scope
        assert actual_receive is receive
        assert actual_send is send
        await actual_send(await actual_receive())

    await ApplicationRateLimitMiddleware(downstream)(scope, receive, send)
    assert sent == [event]


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "pathsend", "disconnect", "failure", "send-failure", "cancel"])
async def test_request_tracking_preserves_stream_and_cleans_context(monkeypatch, outcome):
    from app import middleware as tracking
    from core.logging import _request_id_var, _user_id_var, get_request_id, get_user_id, set_user_id

    records, received, contexts = [], [], []
    entered = asyncio.Event()
    never = asyncio.Event()
    sentinel = RuntimeError("intentional tracking fixture failure")
    scope = {"type": "http", "method": "GET", "path": "/fixture/stream", "query_string": b"private-query-fixture",
             "client": ("127.0.0.1", 1234)}
    start = {"type": "http.response.start", "status": 200, "headers": []}
    body = {"type": "http.response.body", "body": b"first", "more_body": True}

    def log(template, *arguments):
        records.append(template % arguments)

    monkeypatch.setattr(tracking, "logger", SimpleNamespace(info=log, warning=log, exception=log))

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        if outcome == "send-failure" and message["type"] == "http.response.body":
            raise sentinel
        received.append(message)

    async def downstream(actual_scope, actual_receive, actual_send):
        assert actual_scope is scope and actual_receive is receive
        assert len(get_request_id()) == 8 and get_user_id() is None
        set_user_id(42)
        await actual_send(start)
        if outcome == "pathsend":
            await actual_send({"type": "http.response.pathsend", "path": "fixture.csv"})
            return
        await actual_send(body)
        if outcome == "failure":
            raise sentinel
        if outcome == "disconnect":
            assert await actual_receive() == {"type": "http.disconnect"}
            return
        if outcome == "cancel":
            entered.set()
            await never.wait()
        await actual_send({"type": "http.response.body", "body": b"last", "more_body": False})

    request_token = _request_id_var.set("outer-context")
    user_token = _user_id_var.set(99)

    async def invoke():
        try:
            await tracking.RequestTrackingMiddleware(downstream)(scope, receive, send)
        finally:
            contexts.append((get_request_id(), get_user_id()))

    try:
        if outcome == "cancel":
            task = asyncio.create_task(invoke())
            await asyncio.wait_for(entered.wait(), timeout=2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        elif outcome in {"failure", "send-failure"}:
            with pytest.raises(RuntimeError) as failure:
                await invoke()
            assert failure.value is sentinel
        else:
            await invoke()
        assert contexts == [("outer-context", 99)]
        assert (get_request_id(), get_user_id()) == ("outer-context", 99)
    finally:
        _request_id_var.reset(request_token)
        _user_id_var.reset(user_token)
    headers = dict(start["headers"])
    assert len(headers[b"x-request-id"]) == 8
    assert float(headers[b"x-process-time"]) >= 0
    assert received[0] is start
    assert len(records) == 1 and "private-query-fixture" not in records[0]
    assert sum(item["type"] == "http.response.start" for item in received) == 1
    if outcome in {"failure", "disconnect", "cancel"}:
        assert received == [start, body]  # No synthetic success/end chunk.
    if outcome == "send-failure":
        assert received == [start]
    if outcome == "success":
        assert len(received) == 3 and received[-1]["more_body"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("scope_type", ["lifespan", "websocket"])
async def test_request_tracking_passes_non_http_unchanged(scope_type):
    from app.middleware import RequestTrackingMiddleware
    from core.logging import get_request_id, get_user_id

    scope, event, sent = {"type": scope_type}, {"type": f"{scope_type}.fixture"}, []
    before = (get_request_id(), get_user_id())

    async def receive():
        return event

    async def send(message):
        sent.append(message)

    async def downstream(actual_scope, actual_receive, actual_send):
        assert actual_scope is scope and actual_receive is receive and actual_send is send
        assert (get_request_id(), get_user_id()) == before
        await actual_send(await actual_receive())

    await RequestTrackingMiddleware(downstream)(scope, receive, send)
    assert sent == [event]
    assert (get_request_id(), get_user_id()) == before


async def probe(scenario: str) -> dict:
    import httpx
    import uvicorn
    from fastapi.responses import StreamingResponse
    from slowapi import Limiter

    assert Limiter.limit.__module__ == "slowapi.extension"
    from core.rate_limit import limiter
    from core.security import hash_password
    from database import Base, async_session_maker, engine
    from main import app
    from models import Agency, AgencyCustomer, Order, StaffUser
    from services.staff_service import create_staff_access_token

    assert limiter.enabled
    limiter._headers_enabled = True
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_session_maker() as session:
        agencies = [Agency(name=f"CSV fixture {index}") for index in range(2)]
        session.add_all(agencies)
        await session.flush()
        staff = [
            StaffUser(username=f"csv-{index}", display_name="CSV fixture", role=role,
                      password_hash=hash_password(secrets.token_urlsafe(24)),
                      agency_id=agencies[index].id if index < 2 else None,
                      status="active", token_version=1, force_password_reset=False)
            for index, role in enumerate(("agent", "agent", "super_admin"))
        ]
        session.add_all(staff)
        await session.flush()
        if scenario == "paginated":
            customer = AgencyCustomer(agency_id=agencies[0].id, name='=客户, "引号"\n第二行', created_by_staff_id=staff[0].id)
            session.add(customer)
            await session.flush()
            session.add_all([
                Order(order_no=f"CSV-{index:04}", agency_id=agencies[0].id,
                      customer_id=customer.id, amount=Decimal("12.50"),
                      plan_name_snapshot="中文套餐", platform_key="amazon")
                for index in range(501)
            ])
            session.add(Order(order_no="OTHER-AGENCY-PRIVATE", agency_id=agencies[1].id,
                              amount=Decimal("99.00"), plan_name_snapshot="Other plan"))
        await session.commit()
        headers = [{"Authorization": f"Bearer {create_staff_access_token(actor)}"} for actor in staff]
        other_agency_id = agencies[1].id

    if scenario == "stream-failure":
        @app.get("/fixture/stream-failure")
        async def broken_stream():
            async def chunks():
                yield "header\r\n"
                await asyncio.sleep(0.01)
                raise RuntimeError("intentional CSV fixture failure")
            return StreamingResponse(chunks(), media_type="text/csv")

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, lifespan="off", log_level="error"))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        for _ in range(200):
            if server.started:
                break
            if serving.done():
                await serving
            await asyncio.sleep(0.01)
        assert server.started
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", timeout=15) as client:
            if scenario == "stream-failure":
                for encoding in ("gzip", "identity"):
                    async with client.stream("GET", "/fixture/stream-failure", headers={"Accept-Encoding": encoding}) as response:
                        assert response.status_code == 200  # Failure happens after start.
                        assert len(response.headers["x-request-id"]) == 8
                        with pytest.raises(httpx.RemoteProtocolError):
                            await response.aread()
                return {"scenario": scenario, "partial_failure": "not_swallowed", "encodings": ["gzip", "identity"]}
            paths = ["/api/agency/orders/export"]
            if scenario == "empty":
                paths += ["/api/orders/export", "/api/expenses/export", "/api/logs/export"]
            counts = []
            for path in paths:
                for encoding in ("gzip", "identity"):
                    actor_headers = headers[0] if path.startswith("/api/agency/") else headers[2]
                    response = await client.get(path, headers={**actor_headers, "Accept-Encoding": encoding})
                    assert response.status_code == 200, response.text
                    assert response.headers["content-type"].startswith("text/csv")
                    assert "attachment" in response.headers["content-disposition"]
                    assert int(response.headers["x-ratelimit-limit"]) == 60
                    assert len(response.headers["x-request-id"]) == 8
                    assert float(response.headers["x-process-time"]) >= 0
                    assert (response.headers.get("content-encoding") == "gzip") == (encoding == "gzip")
                    assert response.content.startswith(b"\xef\xbb\xbf")
                    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
                    assert len(rows) == (502 if scenario == "paginated" else 1)
                    assert "OTHER-AGENCY-PRIVATE" not in response.text
                    if scenario == "paginated":
                        assert len({row[0] for row in rows[1:]}) == 501
                        assert rows[1][1] == '\'=客户, "引号"\n第二行'
                        assert rows[-1][0] == "CSV-0500"
                    counts.append(len(rows))
            forbidden = await client.get("/api/agency/orders/export", params={"agency_id": other_agency_id}, headers=headers[0])
            assert forbidden.status_code == 403
            assert forbidden.headers["content-type"].startswith("application/json")
            return {"scenario": scenario, "complete_csv_row_counts": counts, "cross_agency_status": 403}
    finally:
        server.should_exit = True
        await asyncio.wait_for(serving, timeout=10)
        listener.close()
        await engine.dispose()
        logging.shutdown()


@pytest.mark.parametrize("scenario", ["empty", "paginated", "stream-failure"])
def test_csv_streaming_with_live_limiter_and_real_http(scenario: str) -> None:
    with tempfile.TemporaryDirectory(prefix="kst-csv-live-") as directory:
        environment = dict(os.environ)
        for key in tuple(environment):
            if key.startswith(("MYSQL_", "REDIS_", "RATELIMIT_")):
                environment.pop(key)
        environment.update(
            APP_ENV="test", DB_TYPE="sqlite", DB_PATH=str(Path(directory) / "fixture.sqlite3"),
            PYTHONPATH=str(ROOT / "backend"), PYTHON_DOTENV_DISABLED="1", PYTHONUTF8="1",
            JWT_SECRET_KEY=secrets.token_urlsafe(48), REDIS_URL="", REDIS_REQUIRED="false",
            DEBUG="false", LOG_LEVEL="CRITICAL", TOOLBOX_RUNTIME_DIR=directory,
            EXPENSE_ATTACHMENT_DIR=str(Path(directory) / "attachments"),
        )
        result = subprocess.run(
            [sys.executable, "-X", "utf8", str(Path(__file__).resolve()), "--probe", scenario],
            cwd=directory, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=45,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "Unexpected message" not in result.stderr
        if scenario != "stream-failure":
            assert "Exception in ASGI application" not in result.stderr
        print(result.stdout.strip().splitlines()[-1])


if __name__ == "__main__":
    assert len(sys.argv) == 3 and sys.argv[1] == "--probe"
    print(json.dumps(asyncio.run(probe(sys.argv[2]))))
