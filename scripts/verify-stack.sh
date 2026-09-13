#!/usr/bin/env sh
set -eu

API_URL="${API_URL:-http://localhost:8000}"

curl --fail --silent "${API_URL}/api/v1/health"
curl --fail --silent "${API_URL}/api/v1/health/ready"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-alpha_radar}" \
  -d "${POSTGRES_DB:-alpha_radar}" \
  -c "SELECT extname FROM pg_extension WHERE extname IN ('timescaledb', 'vector') ORDER BY extname;"
docker compose exec -T redis redis-cli ping
