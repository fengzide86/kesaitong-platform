"""Exercise the installed async MySQL pre-ping adapter without a database."""

import pytest
from sqlalchemy.dialects.mysql.aiomysql import (
    AsyncAdapt_aiomysql_connection,
    MySQLDialect_aiomysql,
)
from sqlalchemy.util.concurrency import greenlet_spawn


@pytest.mark.asyncio
async def test_aiomysql_pre_ping_uses_current_driver_signature_without_reconnect():
    calls = []

    class Connection:
        async def ping(self, reconnect=True):
            calls.append(reconnect)

    dbapi = MySQLDialect_aiomysql.import_dbapi()
    dialect = MySQLDialect_aiomysql(dbapi=dbapi)
    connection = AsyncAdapt_aiomysql_connection(dbapi, Connection())
    assert await greenlet_spawn(dialect.do_ping, connection) is True
    assert await greenlet_spawn(dialect.do_ping, connection) is True
    # Transparent reconnect would silently replace a transaction's connection.
    assert calls == [False, False]
