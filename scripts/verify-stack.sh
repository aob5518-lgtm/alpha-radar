#!/usr/bin/env sh
set -eu

API_URL="${API_URL:-http://localhost:8000}"
POSTGRES_USER="${POSTGRES_USER:-alpha_radar}"
POSTGRES_DB="${POSTGRES_DB:-alpha_radar}"
EXPECTED_ASSET_COUNT=16

curl --fail --silent "${API_URL}/api/v1/health"
curl --fail --silent "${API_URL}/api/v1/health/ready"
docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -c "SELECT extname FROM pg_extension WHERE extname IN ('timescaledb', 'vector') ORDER BY extname;"
docker compose exec -T redis redis-cli ping

run_asset_seed() {
  docker compose run --rm api python -m alpha_radar.assets.seed
}

asset_counts() {
  docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -tAc "SELECT (SELECT count(*) FROM assets), (SELECT count(*) FROM asset_provider_mappings), (SELECT count(*) FROM asset_aliases);"
}

FIRST_SEED_OUTPUT="$(run_asset_seed)"
printf '%s\n' "${FIRST_SEED_OUTPUT}"

ASSET_LIST_JSON="$(curl --fail --silent "${API_URL}/api/v1/assets")"
BITCOIN_JSON="$(curl --fail --silent "${API_URL}/api/v1/assets/bitcoin")"

export ASSET_LIST_JSON
export BITCOIN_JSON
export EXPECTED_ASSET_COUNT
python - <<'PY'
import json
import os

asset_list = json.loads(os.environ["ASSET_LIST_JSON"])
bitcoin = json.loads(os.environ["BITCOIN_JSON"])
expected_count = int(os.environ["EXPECTED_ASSET_COUNT"])

total_items = asset_list["pagination"]["total_items"]
if total_items != expected_count:
    raise SystemExit(f"expected {expected_count} seeded assets, got {total_items}")

if bitcoin["symbol"] != "BTC":
    raise SystemExit(f"expected bitcoin symbol BTC, got {bitcoin['symbol']}")

expected_mappings = {
    ("binance", "BTCUSDT", "BTCUSDT"),
    ("coinbase", "BTC-USD", "BTC-USD"),
    ("coingecko", "bitcoin", "BTC"),
}
actual_mappings = {
    (
        mapping["provider"],
        mapping["provider_asset_id"],
        mapping["provider_symbol"],
    )
    for mapping in bitcoin["provider_mappings"]
}
missing_mappings = expected_mappings - actual_mappings
if missing_mappings:
    raise SystemExit(f"bitcoin is missing provider mappings: {sorted(missing_mappings)}")

print("Asset API verification passed.")
PY

COUNTS_AFTER_FIRST_SEED="$(asset_counts)"
SECOND_SEED_OUTPUT="$(run_asset_seed)"
printf '%s\n' "${SECOND_SEED_OUTPUT}"
COUNTS_AFTER_SECOND_SEED="$(asset_counts)"

if [ "${COUNTS_AFTER_FIRST_SEED}" != "${COUNTS_AFTER_SECOND_SEED}" ]; then
  printf 'Asset seed is not idempotent.\nBefore: %s\nAfter: %s\n' \
    "${COUNTS_AFTER_FIRST_SEED}" "${COUNTS_AFTER_SECOND_SEED}" >&2
  exit 1
fi

if [ "${COUNTS_AFTER_SECOND_SEED}" != "16|9|38" ]; then
  printf 'Unexpected asset table counts after second seed: %s\n' \
    "${COUNTS_AFTER_SECOND_SEED}" >&2
  exit 1
fi

case "${SECOND_SEED_OUTPUT}" in
  *"0 assets, 0 mappings, 0 aliases created."*)
    printf 'Asset seed idempotency verification passed.\n'
    ;;
  *)
    printf 'Unexpected second seed output: %s\n' "${SECOND_SEED_OUTPUT}" >&2
    exit 1
    ;;
esac

run_market_data_seed() {
  docker compose run --rm api python -m alpha_radar.market_data.seed
}

market_data_counts() {
  docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -tAc "SELECT (SELECT count(*) FROM market_instruments), (SELECT count(*) FROM market_quotes), (SELECT count(*) FROM market_candles);"
}

docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('market_instruments', 'market_quotes', 'market_candles') ORDER BY table_name;"

HYPERTABLES="$(docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -tAc "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema = 'public' AND hypertable_name IN ('market_quotes', 'market_candles') ORDER BY hypertable_name;")"
if [ "${HYPERTABLES}" != "market_candles
market_quotes" ]; then
  printf 'Expected market quote and candle hypertables, got:\n%s\n' "${HYPERTABLES}" >&2
  exit 1
fi

FIRST_MARKET_SEED_OUTPUT="$(run_market_data_seed)"
printf '%s\n' "${FIRST_MARKET_SEED_OUTPUT}"
MARKET_COUNTS_AFTER_FIRST="$(market_data_counts)"

MARKET_QUOTE_JSON="$(curl --fail --silent "${API_URL}/api/v1/assets/bitcoin/quote")"
MARKET_HISTORY_JSON="$(curl --fail --silent "${API_URL}/api/v1/assets/bitcoin/history?interval=1h&limit=10")"
export MARKET_QUOTE_JSON
export MARKET_HISTORY_JSON
python - <<'PY'
from decimal import Decimal
import json
import os

quote = json.loads(os.environ["MARKET_QUOTE_JSON"])
history = json.loads(os.environ["MARKET_HISTORY_JSON"])

if quote["symbol"] != "BTC" or quote["provider"] != "mock":
    raise SystemExit(f"unexpected quote identity: {quote}")
if quote["quote_currency"] != "USD":
    raise SystemExit(f"expected explicit USD quote currency, got {quote['quote_currency']}")
if Decimal(quote["price"]) != Decimal("60000.12345678"):
    raise SystemExit(f"unexpected Decimal quote price: {quote['price']}")
if quote["asset_id"] != history["asset_id"]:
    raise SystemExit("quote and history do not link to the same canonical Asset UUID")
if len(history["items"]) != 3:
    raise SystemExit(f"expected 3 sample candles, got {len(history['items'])}")
open_times = [item["open_time"] for item in history["items"]]
if open_times != sorted(open_times):
    raise SystemExit("history API is not ordered by open_time ascending")
if any(item["market_instrument_id"] != quote["market_instrument_id"] for item in history["items"]):
    raise SystemExit("history contains a candle from the wrong market instrument")

print("Market quote and history API verification passed.")
PY

SECOND_MARKET_SEED_OUTPUT="$(run_market_data_seed)"
printf '%s\n' "${SECOND_MARKET_SEED_OUTPUT}"
MARKET_COUNTS_AFTER_SECOND="$(market_data_counts)"

FIRST_INSTRUMENTS="$(printf '%s' "${MARKET_COUNTS_AFTER_FIRST}" | cut -d'|' -f1)"
FIRST_QUOTES="$(printf '%s' "${MARKET_COUNTS_AFTER_FIRST}" | cut -d'|' -f2)"
FIRST_CANDLES="$(printf '%s' "${MARKET_COUNTS_AFTER_FIRST}" | cut -d'|' -f3)"
SECOND_INSTRUMENTS="$(printf '%s' "${MARKET_COUNTS_AFTER_SECOND}" | cut -d'|' -f1)"
SECOND_QUOTES="$(printf '%s' "${MARKET_COUNTS_AFTER_SECOND}" | cut -d'|' -f2)"
SECOND_CANDLES="$(printf '%s' "${MARKET_COUNTS_AFTER_SECOND}" | cut -d'|' -f3)"

if [ "${FIRST_INSTRUMENTS}" != "4" ] || [ "${SECOND_INSTRUMENTS}" != "4" ]; then
  printf 'Market instrument seed is not idempotent: %s -> %s\n' \
    "${FIRST_INSTRUMENTS}" "${SECOND_INSTRUMENTS}" >&2
  exit 1
fi
if [ "${FIRST_CANDLES}" != "3" ] || [ "${SECOND_CANDLES}" != "3" ]; then
  printf 'Candle upsert created duplicates: %s -> %s\n' \
    "${FIRST_CANDLES}" "${SECOND_CANDLES}" >&2
  exit 1
fi
if [ "${SECOND_QUOTES}" -ne "$((FIRST_QUOTES + 1))" ]; then
  printf 'Expected append-only quote observation count to increase by one: %s -> %s\n' \
    "${FIRST_QUOTES}" "${SECOND_QUOTES}" >&2
  exit 1
fi

printf 'Market instrument and candle idempotency verification passed.\n'

docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('sources', 'source_documents', 'source_document_versions') ORDER BY table_name;"

FIRST_SOURCE_SEED="$(docker compose run --rm api python -m alpha_radar.sources.seed)"
SECOND_SOURCE_SEED="$(docker compose run --rm api python -m alpha_radar.sources.seed)"
printf '%s\n%s\n' "${FIRST_SOURCE_SEED}" "${SECOND_SOURCE_SEED}"
SOURCE_COUNT="$(docker compose exec -T postgres psql -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" -tAc "SELECT count(*) FROM sources;")"
if [ "${SOURCE_COUNT}" != "2" ]; then
  printf 'Expected two idempotently seeded official sources, got %s\n' "${SOURCE_COUNT}" >&2
  exit 1
fi

MOCK_OUTPUT="$(docker compose run --rm api python -m alpha_radar.sources.integration_verify)"
printf '%s\n' "${MOCK_OUTPUT}"
DOCUMENT_LIST_JSON="$(curl --fail --silent "${API_URL}/api/v1/documents?source=mock-source")"
SOURCE_LIST_JSON="$(curl --fail --silent "${API_URL}/api/v1/sources")"
export DOCUMENT_LIST_JSON SOURCE_LIST_JSON
export API_URL
python - <<'PY'
import json
import os
from urllib.request import urlopen

documents = json.loads(os.environ["DOCUMENT_LIST_JSON"])
sources = json.loads(os.environ["SOURCE_LIST_JSON"])
if documents["pagination"]["total_items"] != 1:
    raise SystemExit(f"expected one mock source document: {documents}")
document = documents["items"][0]
if document["current_version"]["version_number"] != 2:
    raise SystemExit(f"expected current revision 2: {document}")
if len({item["slug"] for item in sources["items"]}) != 3:
    raise SystemExit(f"expected unique official + integration sources: {sources}")
detail = json.load(urlopen(os.environ["API_URL"] + "/api/v1/documents/" + document["id"], timeout=10))
if detail["id"] != document["id"] or "metadata" in detail:
    raise SystemExit(f"unexpected source detail contract: {detail}")
print("Source list/detail API and revision verification passed.")
PY
