"""Real Redis client + isolated loopback RESP fault injection (no production)."""
import asyncio
import socket
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

from core.cache import CacheManager
from core.config import settings


class RedisWireFixture:
    """Small RESP peer, not a Redis engine; exercises real socket failure paths."""
    def __init__(self):
        self.server = None
        self.writers = set()
        self.hang = False
        self.drop_ping = False
        self.data = {}

    async def start(self, port=0):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", port)
        return self.server.sockets[0].getsockname()[1]

    async def close(self):
        for writer in list(self.writers):
            writer.close()
            await writer.wait_closed()
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def handle(self, reader, writer):
        self.writers.add(writer)
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                count = int(line[1:])
                command = []
                for _ in range(count):
                    length = int((await reader.readline())[1:])
                    command.append((await reader.readexactly(length + 2))[:-2].decode())
                if self.hang:
                    await reader.read()
                    break
                name = command[0].upper()
                if name == "PING" and self.drop_ping:
                    self.drop_ping = False
                    break
                if name == "PING":
                    response = b"+PONG\r\n"
                elif name == "GET":
                    value = self.data.get(command[1])
                    response = b"$-1\r\n" if value is None else f"${len(value.encode())}\r\n{value}\r\n".encode()
                elif name == "SETEX":
                    self.data[command[1]] = command[3]
                    response = b"+OK\r\n"
                else:  # AUTH and CLIENT SETINFO are connection handshakes.
                    response = b"+OK\r\n"
                writer.write(response)
                await writer.drain()
        except (OSError, asyncio.IncompleteReadError):
            pass
        finally:
            self.writers.discard(writer)
            writer.close()
            await writer.wait_closed()


@pytest_asyncio.fixture
async def redis_wire():
    peer = RedisWireFixture()
    yield peer
    await peer.close()


@pytest.mark.asyncio
async def test_failed_startup_recovers_same_client_without_restart(redis_wire, monkeypatch):
    reservation = socket.socket()
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
    reservation.close()
    monkeypatch.setattr(settings, "REDIS_URL", f"redis://127.0.0.1:{port}/0")
    manager = CacheManager()
    manager.retry_interval = 0
    try:
        await manager.init()  # refused real TCP connection
        assert manager.redis_error
        original_pool = manager.redis
        assert original_pool is not None
        await redis_wire.start(port)
        await manager.init()
        assert manager.redis is original_pool
        assert manager.redis_error is None
        assert await manager.set("fixture", {"ok": True}) is True
        assert await manager.get("fixture") == {"ok": True}
        assert await manager.check_health() == {"status": "ok"}
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_connection_drop_is_reported_then_recovers(redis_wire, monkeypatch):
    port = await redis_wire.start()
    monkeypatch.setattr(settings, "REDIS_URL", f"redis://127.0.0.1:{port}/0")
    manager = CacheManager()
    manager.retry_interval = 0
    try:
        await manager.init()
        redis_wire.drop_ping = True
        failed = await manager.check_health()
        assert failed["status"] == "error"
        assert await manager.check_health() == {"status": "ok"}
        assert manager.redis_error is None
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_unresponsive_tcp_peer_has_bounded_timeout(redis_wire, monkeypatch):
    port = await redis_wire.start()
    redis_wire.hang = True
    monkeypatch.setattr(settings, "REDIS_URL", f"redis://127.0.0.1:{port}/0")
    manager = CacheManager()
    manager.operation_timeout = 0.1
    try:
        began = time.monotonic()
        await manager.init()
        assert time.monotonic() - began < 0.8
        assert manager.redis_error == "TimeoutError"
        assert (await manager.check_health())["status"] == "error"
    finally:
        await manager.close()


@pytest.mark.asyncio
async def test_redis_error_and_cache_keys_do_not_persist_credentials(monkeypatch, caplog):
    manager = CacheManager()
    manager.redis = SimpleNamespace(get=AsyncMock(side_effect=ConnectionError("redis://user:private-password@localhost:6379/0 refused")))
    assert await manager.get("auth_codes:detail:private-code") is None
    assert "private-" not in caplog.text
    assert "private-" not in manager.redis_error
    assert "ConnectionError" in caplog.text
