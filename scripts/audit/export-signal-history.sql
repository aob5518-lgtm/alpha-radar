-- Run with psql -X -qAt, against the production database through a read-only session.
-- No provider calls, writes, temporary tables, or open candles.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '90s';
SET LOCAL TIME ZONE 'UTC';
WITH selected AS (
  SELECT c.*, i.provider_instrument_id AS symbol
  FROM market_candles c JOIN market_instruments i ON i.id=c.market_instrument_id
  WHERE c.provider='bybit' AND i.provider='bybit'
    AND i.instrument_type='perpetual' AND i.quote_currency='USDT'
    AND i.provider_instrument_id IN ('BTCUSDT','ETHUSDT','SOLUSDT')
    AND c.interval IN ('15m','1h','4h','1d')
    AND c.is_closed AND c.close_time <= transaction_timestamp()
    AND c.open_time >= transaction_timestamp() - interval '90 days'
      - make_interval(secs => 800 * CASE c.interval
          WHEN '15m' THEN 900 WHEN '1h' THEN 3600 WHEN '4h' THEN 14400 ELSE 86400 END)
), groups AS (
  SELECT symbol, market_instrument_id, interval,
    json_agg(json_build_object(
      'asset_id',asset_id,'market_instrument_id',market_instrument_id,
      'provider','bybit','interval',interval,'open_time',open_time,'close_time',close_time,
      'open',open::text,'high',high::text,'low',low::text,'close',close::text,
      'volume',volume::text,'quote_volume',quote_volume::text,'is_closed',is_closed,
      'provider_timestamp',provider_timestamp,'ingested_at',ingested_at,
      'quality_flags',quality_flags
    ) ORDER BY open_time) AS candles
  FROM selected GROUP BY symbol,market_instrument_id,interval
)
SELECT json_build_object(
  'format','alpha-radar-signal-history-v1',
  'exported_at',transaction_timestamp(),
  'requested_start',transaction_timestamp()-interval '90 days',
  'base_sha','69a74425e68157ef634a723309d665b3996d9509',
  'series',json_agg(json_build_object('symbol',symbol,'id',market_instrument_id,
    'interval',interval,'candles',candles) ORDER BY symbol,interval)
) FROM groups;
ROLLBACK;
