# Trade Guide decision explanation

This presentation update starts from merged main
`80a9f0ff8a53097c1b7fc692aa3bef616f17ead2`. It applies the reviewed educational
video's separation of direction, location and confirmation to the existing Guide.
It does not treat the video's performance claims or discretionary gold examples as
validated rules for crypto perpetuals.

## Existing authority

Entry V1.2 and Guide V1.1 remain the sole setup/plan authority. Structural Levels
V1.1, Trend V1.1, Market State V1, retest/expiry/no-chase policy, evidence weights,
R:R thresholds, stops, targets and markers are unchanged. No API, storage schema,
provider, dependency, indicator or order/position-management system is added.

`describeGuideDecision` is a pure presentation mapping. It reads the accepted Guide
and optional MA analysis, without engine calls, history traversal, live quote,
clock, storage or asynchronous work. The existing Chart identity/confirmed-context
guards continue to control both the primary Guide and marker tooltip.

## Three steps in the existing surface

1. **Direction:** explicitly scoped to the current timeframe, with a reminder that
   a long/short bias is not entry confirmation. A WAIT may retain an observational
   bias only from coherent MA evidence without directional conflict; it gains no plan.
2. **Location:** only the Guide's current READY/WATCH zone is shown. WATCH retains
   its unconfirmed-area label. WAIT and MISSED never expose retained reference
   prices as current entry locations. No A/V, engulfing or Gap levels are inferred.
3. **Confirmation:** READY reflects the existing all-gates-passed contract. WATCH
   separates missing closed price confirmation from price already confirmed while
   quality or R:R is still insufficient. WAIT retains its existing rejection
   reasons. MISSED retains no-chase semantics.

WATCH next-action copy explains the actual blocker: closed reclaim/rejection,
supporting evidence, or R:R. Multiple unmet conditions are not hidden: the existing
Guide reason row remains visible, including a low R:R when price is also pending.
Neither a confirmed price action nor the three-step display can promote WATCH to READY.

MA confirmation evidence must match instrument UUID, timeframe, candle open/close
timestamps, direction and MA settings. Missing/mismatched evidence is explicitly
unverified; it is never borrowed from another instrument, period or setting. READY
can still be explained from the authoritative Guide contract when optional MA
evidence is absent. Both languages share identical presentation keys.

## Validation and boundaries

Tests cover mirrored long/short READY and WATCH, separate price/evidence/R:R waits,
WAIT bias versus invalid location, mismatched UUID/timeframe/timestamps/settings,
retained MISSED references, malformed zones, input immutability, partial-candle
exclusion and real bilingual TSX rendering. The historical presentation harness
uses the same mapper for primary and tooltip output. Existing frozen-engine,
identity/socket/cache, replay and eight-marker-limit tests remain required.

The video does not specify reproducible multi-timeframe SnR selection, departure
distance, first-touch reset or execution-cost rules. This change therefore adds
no first-touch claims, false-breakout detector, higher-timeframe agreement claim,
position sizing, partial-exit lifecycle or expected win rate. Those would require
separate versioned definitions and historical validation, rather than a UI change.
