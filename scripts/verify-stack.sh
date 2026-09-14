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
