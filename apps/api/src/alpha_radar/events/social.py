from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, cast
from urllib.parse import quote, urlencode

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from alpha_radar.config import CryptoEventFeedSettings, Settings, SocialAccountKey
from alpha_radar.events.crypto import CryptoEventCandidate, CryptoEventClassification
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.schemas import FetchedSourceDocument
from alpha_radar.sources.transport import SourceTransport

SocialAccountTier = Literal["tier_1", "tier_2", "tier_3"]
X_API_HOST = "api.x.com"


class SocialAccount(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: SocialAccountKey
    username: str = Field(pattern=r"^[A-Za-z0-9_]{1,15}$")
    display_name: str = Field(min_length=1, max_length=255)
    tier: SocialAccountTier
    asset_symbols: list[str] = Field(default_factory=list, max_length=20)


class SocialProvider(Protocol):
    @property
    def provider_name(self) -> str: ...

    async def fetch_account(
        self, account: SocialAccount, *, limit: int
    ) -> list[CryptoEventCandidate]: ...


class XUser(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[0-9]{1,19}$")
    username: str = Field(pattern=r"^[A-Za-z0-9_]{1,15}$")
    name: str


class XPostReference(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    id: str | None = None


class XPost(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[0-9]{1,19}$")
    text: str = Field(min_length=1, max_length=25_000)
    author_id: str = Field(pattern=r"^[0-9]{1,19}$")
    created_at: datetime
    referenced_tweets: list[XPostReference] = Field(default_factory=list[XPostReference])


_SOCIAL_MATERIAL = re.compile(
    r"\b(mainnet|network upgrade|protocol upgrade|hard fork|security warning|"
    r"security incident|exploit|hack|token launch|tge|official listing|will list|"
    r"major partnership|major integration|product launch|meme launch)\b",
    re.I,
)
_SOCIAL_NOISE = re.compile(
    r"\b(giveaway|follow for follow|like and repost|engagement|weekly recap|ama|"
    r"meetup|podcast|tutorial|community event)\b",
    re.I,
)


def social_account_settings() -> dict[SocialAccountKey, SocialAccount]:
    """Small reviewed handle allowlist. Numeric X IDs are resolved by the official API."""
    accounts: tuple[tuple[SocialAccountKey, str, str, SocialAccountTier, list[str]], ...] = (
        ("elon-musk", "elonmusk", "Elon Musk", "tier_1", []),
        ("bitcoin-core", "BitcoinCoreOrg", "Bitcoin Core", "tier_2", ["BTC"]),
        ("ethereum", "ethereum", "Ethereum", "tier_2", ["ETH"]),
        ("solana", "solana", "Solana", "tier_2", ["SOL"]),
        ("anza", "anza_xyz", "Anza", "tier_2", ["SOL"]),
        ("sui", "SuiNetwork", "Sui", "tier_2", ["SUI"]),
        ("chainlink", "chainlink", "Chainlink", "tier_2", ["LINK"]),
        ("avalanche", "avax", "Avalanche", "tier_2", ["AVAX"]),
        ("dogecoin", "dogecoin", "Dogecoin", "tier_2", ["DOGE"]),
        (
            "bitcoin-cash-node",
            "BitcoinCashNode",
            "Bitcoin Cash Node",
            "tier_2",
            ["BCH"],
        ),
    )
    return {
        key: SocialAccount(
            key=key,
            username=username,
            display_name=name,
            tier=cast(SocialAccountTier, tier),
            asset_symbols=symbols,
        )
        for key, username, name, tier, symbols in accounts
    }


def configured_social_accounts(keys: list[SocialAccountKey]) -> list[SocialAccount]:
    definitions = social_account_settings()
    return [definitions[key] for key in dict.fromkeys(keys)]


def social_monitoring_enabled(settings: Settings) -> bool:
    return bool(
        settings.crypto_event_sync_enabled
        and settings.crypto_social_provider == "x"
        and settings.x_bearer_token.strip()
        and settings.crypto_social_accounts
    )


class XSocialProvider:
    """Official X API v2 bounded user-timeline adapter; no HTML scraping or public stream."""

    provider_name = "x"

    def __init__(
        self,
        transport: SourceTransport,
        bearer_token: str,
        *,
        now: datetime | None = None,
    ) -> None:
        token = bearer_token.strip()
        if not token:
            raise SourceError("policy_restricted", "X API bearer token is required")
        self.transport = transport
        self.bearer_token = token
        self.now = now

    async def fetch_account(
        self, account: SocialAccount, *, limit: int
    ) -> list[CryptoEventCandidate]:
        reviewed = social_account_settings().get(account.key)
        if reviewed != account:
            raise SourceError("policy_restricted", "X account is outside the reviewed allowlist")
        if not 5 <= limit <= 100:
            raise SourceError("invalid_payload", "X recent result limit must be between 5 and 100")
        headers = {"Authorization": f"Bearer {self.bearer_token}"}
        username = quote(account.username, safe="")
        user_response, _, _ = await self.transport.get(
            f"https://{X_API_HOST}/2/users/by/username/{username}",
            allowed_hosts=frozenset({X_API_HOST}),
            headers=headers,
        )
        user = _x_user(user_response.json(), account)
        now = (self.now or datetime.now(UTC)).astimezone(UTC)
        query = urlencode(
            {
                "max_results": limit,
                "start_time": (now - timedelta(days=7)).isoformat().replace("+00:00", "Z"),
                "exclude": "replies,retweets",
                "tweet.fields": "created_at,author_id,referenced_tweets",
            }
        )
        posts_response, observed_at, fetched_at = await self.transport.get(
            f"https://{X_API_HOST}/2/users/{user.id}/tweets?{query}",
            allowed_hosts=frozenset({X_API_HOST}),
            headers=headers,
        )
        return self.normalize(
            account,
            user,
            posts_response.json(),
            observed_at=observed_at,
            fetched_at=fetched_at,
        )

    @staticmethod
    def normalize(
        account: SocialAccount,
        user: XUser,
        payload: object,
        *,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[CryptoEventCandidate]:
        try:
            if not isinstance(payload, dict):
                raise ValueError("Expected an X API object")
            payload_map = cast(dict[str, object], payload)
            raw_posts = payload_map.get("data", [])
            if not isinstance(raw_posts, list):
                raise ValueError("Expected an X post list")
            posts = [XPost.model_validate(item) for item in cast(list[object], raw_posts)]
        except (TypeError, ValueError, ValidationError) as error:
            raise SourceError("parser_error", "Invalid X API posts response") from error

        source = _social_source(account)
        candidates: list[CryptoEventCandidate] = []
        for post in posts:
            if post.author_id != user.id:
                raise SourceError("invalid_payload", "X post author did not match resolved account")
            if post.created_at.tzinfo is None:
                raise SourceError("parser_error", "X post timestamp requires timezone")
            symbols = extract_social_asset_symbols(post.text)
            classification = classify_social_post(account, post, symbols)
            symbol_label = ", ".join(symbols)
            title = f"X post by @{account.username}"
            if symbol_label:
                title += f" mentioning {symbol_label}"
            candidates.append(
                CryptoEventCandidate(
                    source=source,
                    asset_symbols=symbols,
                    classification_hint=classification,
                    channel="social",
                    evidence=FetchedSourceDocument(
                        external_id=post.id,
                        canonical_url=f"https://x.com/{account.username}/status/{post.id}",
                        document_type="social_post",
                        title=title,
                        author=f"@{account.username}",
                        language=None,
                        summary=post.text,
                        published_at=post.created_at.astimezone(UTC),
                        observed_at=observed_at,
                        fetched_at=fetched_at,
                        metadata={
                            "platform": "x",
                            "account_key": account.key,
                            "account_username": account.username,
                            "account_tier": account.tier,
                            "resolved_account_id": user.id,
                            "post_id": post.id,
                            "classification_source": "deterministic_social_policy",
                        },
                    ),
                )
            )
        return candidates


def classify_social_post(
    account: SocialAccount, post: XPost, symbols: list[str]
) -> CryptoEventClassification:
    reference_types = {reference.type for reference in post.referenced_tweets}
    if reference_types.intersection({"retweeted", "replied_to"}):
        return _social_rejected("Replies and reposts are not new independent signals")
    if _SOCIAL_NOISE.search(post.text):
        return _social_rejected("Generic engagement or community content")
    if not symbols:
        return _social_rejected("No unambiguous tracked Asset mention")
    if account.tier != "tier_1" and not _SOCIAL_MATERIAL.search(post.text):
        return _social_rejected("Official account post lacks an explicit material event concept")
    return CryptoEventClassification(
        relevant=True,
        event_type="influential_social",
        importance="high",
        recommended_action="wait_for_confirmation",
        confidence="high",
        reason="Reviewed monitored account explicitly mentioned a tracked Asset",
    )


def extract_social_asset_symbols(value: str) -> list[str]:
    names = {
        "BTC": ("bitcoin",),
        "ETH": ("ethereum", "ether"),
        "SOL": ("solana",),
        "SUI": ("sui",),
        "LINK": ("chainlink",),
        "AVAX": ("avalanche",),
        "DOGE": ("dogecoin", "doge"),
        "BCH": ("bitcoin cash",),
    }
    lowered = value.lower()
    matches: list[str] = []
    for symbol, aliases in names.items():
        explicit_symbol = bool(
            re.search(rf"(?<![A-Za-z0-9])\$?{symbol}(?![A-Za-z0-9])", value, re.I)
        )
        explicit_name = any(re.search(rf"\b{re.escape(alias)}\b", lowered) for alias in aliases)
        if explicit_symbol or explicit_name:
            matches.append(symbol)
    return matches


def _social_source(account: SocialAccount) -> CryptoEventFeedSettings:
    return CryptoEventFeedSettings(
        slug=f"x-{account.key}",
        name=f"{account.display_name} on X",
        source_type="social",
        base_url=f"https://x.com/{account.username}",
        feed_url=f"https://api.x.com/2/users/by/username/{account.username}",
        event_type="influential_social",
        asset_symbols=account.asset_symbols,
        importance="high",
        recommended_action="wait_for_confirmation",
        opportunity_signal="wait",
        confidence="high",
        lookback_days=7,
        recent_item_limit=10,
    )


def _x_user(payload: object, account: SocialAccount) -> XUser:
    try:
        if not isinstance(payload, dict):
            raise ValueError("Expected an X API object")
        payload_map = cast(dict[str, object], payload)
        user = XUser.model_validate(payload_map.get("data"))
    except (TypeError, ValueError, ValidationError) as error:
        raise SourceError("parser_error", "Invalid X API user response") from error
    if user.username.lower() != account.username.lower():
        raise SourceError("invalid_payload", "X account resolution returned another username")
    return user


def _social_rejected(reason: str) -> CryptoEventClassification:
    return CryptoEventClassification(
        relevant=False,
        event_type="influential_social",
        importance="low",
        recommended_action="watch",
        confidence="high",
        reason=reason,
    )
