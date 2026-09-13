from collections.abc import AsyncIterator
from typing import Protocol

import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from alpha_radar.db import models as registered_models
from alpha_radar.db.base import Base

_ = registered_models


class Cursor(Protocol):
    def execute(self, statement: str) -> object: ...

    def close(self) -> None: ...


class DatabaseConnection(Protocol):
    def cursor(self) -> Cursor: ...


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    def enable_foreign_keys(
        dbapi_connection: DatabaseConnection, _connection_record: object
    ) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    event.listen(engine.sync_engine, "connect", enable_foreign_keys)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as database_session:
        yield database_session

    await engine.dispose()
