import asyncio
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.sources.models import Source


async def seed_sources(session: AsyncSession, *, include_mock: bool = False) -> None:
    seeds: list[tuple[str, str, str, str, str, str, str | None]] = [
        (
            "sec",
            "SEC",
            "regulator",
            "sec",
            "https://www.sec.gov",
            "public_official",
            "https://www.sec.gov/about/webmaster-frequently-asked-questions",
        ),
        (
            "federal-reserve",
            "Federal Reserve",
            "central_bank",
            "fed",
            "https://www.federalreserve.gov",
            "metadata_only",
            "https://www.federalreserve.gov/disclaimer.htm",
        ),
    ]
    if include_mock:
        seeds.append(
            (
                "mock-source",
                "Mock Source (Demo)",
                "government",
                "mock",
                "https://example.invalid",
                "excerpt_allowed",
                None,
            )
        )
    for slug, name, source_type, provider, url, license_class, terms_url in seeds:
        values = dict(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:source:{slug}"),
            slug=slug,
            name=name,
            source_type=source_type,
            source_tier="primary",
            provider=provider,
            base_url=url,
            language="en",
            status="active",
            latency_class="periodic",
            license_class=license_class,
            terms_url=terms_url,
            metadata_={"is_demo": provider == "mock"},
        )
        insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
        await session.execute(
            insert(Source).values(**values).on_conflict_do_nothing(index_elements=["slug"])
        )
    await session.commit()


async def main() -> None:
    try:
        async with async_session_factory() as session:
            await seed_sources(session)
        print("Source registry seed complete (idempotent).")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
