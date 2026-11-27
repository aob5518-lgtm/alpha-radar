from __future__ import annotations

import hashlib
import json
import math
from bisect import bisect_right
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from alpha_radar.event_contracts.strategy import (
    RULES,
    VERSION,
    Bar,
    Horizon,
    aggregate,
    break_even_probability,
    classify,
)


def wilson(wins: int, count: int) -> list[float] | None:
    """Descriptive interval only; overlapping/serially correlated markets are not IID."""
    if not count:
        return None
    p, z = wins / count, 1.96
    center = (p + z * z / (2 * count)) / (1 + z * z / count)
    half = z * math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / (1 + z * z / count)
    return [center - half, center + half]


def replay(
    history: list[Bar],
    horizon: Horizon,
    *,
    macro_windows: list[tuple[datetime, datetime]],
    payout: Decimal | None = None,
) -> dict[str, Any]:
    """Frozen rules, chronological purged splits, minute-open proxy labels, no persistence."""
    bars = sorted((bar for bar in history if bar.is_closed), key=lambda bar: bar.open_time)
    if len(bars) < RULES.history_minutes + horizon + 2:
        raise ValueError("Insufficient historical research input")
    environments = aggregate(bars, 5 if horizon == 10 else 15)
    triggers = bars if horizon == 10 else aggregate(bars, 5)
    env_times = [bar.close_time for bar in environments]
    trigger_times = [bar.close_time for bar in triggers]
    by_open = {bar.open_time: bar for bar in bars}
    first, last = bars[0].open_time, bars[-1].close_time
    duration = last - first
    boundaries = [first, first + duration * 0.6, first + duration * 0.8, last]
    rows: list[dict[str, object]] = []
    baseline: dict[str, list[int]] = {"always_up": [0, 0], "previous_5m_direction": [0, 0]}
    seen: set[str] = set()
    next_eligible = first
    considered = 0
    reasons: dict[str, int] = {}
    for index in range(RULES.history_minutes - 1, len(bars) - horizon - 2):
        at = bars[index].close_time
        if horizon == 30 and at.minute % 5:
            continue
        # One-minute publication/entry delay in the proxy audit, never a historical close fill.
        entry_at, expires = at + timedelta(minutes=1), at + timedelta(minutes=1 + horizon)
        split = next(
            (
                name
                for name, low, high in zip(
                    ("development", "validation", "holdout"),
                    boundaries,
                    boundaries[1:],
                    strict=False,
                )
                if low <= at and expires < high
            ),
            None,
        )
        if split is None:
            continue  # Purge outcomes crossing chronological split boundaries.
        considered += 1
        blocked = any(low <= expires and high >= at for low, high in macro_windows)
        trigger_end = bisect_right(trigger_times, at)
        env_end = bisect_right(env_times, at)
        assessment = classify(
            bars[index - RULES.history_minutes + 1 : index + 1],
            horizon,
            as_of=at,
            macro_blocked=blocked,
            prepared=(
                triggers[max(0, trigger_end - RULES.feature_bars) : trigger_end],
                environments[max(0, env_end - RULES.feature_bars) : env_end],
            ),
        )
        for reason in assessment.reasons:
            reasons[reason] = reasons.get(reason, 0) + 1
        if assessment.direction not in ("up", "down"):
            continue
        episode = assessment.episode_key
        if episode is None or episode in seen or at <= next_eligible:
            continue
        seen.add(episode)
        next_eligible = expires
        entry, end = by_open.get(entry_at), by_open.get(expires)
        if entry is None or end is None:
            rows.append({"at": at.isoformat(), "split": split, "outcome": "missing"})
            continue
        outcome = "up" if end.open > entry.open else "down" if end.open < entry.open else "tie"
        matched = assessment.direction == outcome
        five_before = bars[index - 5].close
        naive = "up" if bars[index].close >= five_before else "down"
        for key, guess in (("always_up", "up"), ("previous_5m_direction", naive)):
            baseline[key][0] += int(guess == outcome)
            baseline[key][1] += int(outcome != "tie")
        rows.append(
            {
                "at": at.isoformat(),
                "entry_at": entry_at.isoformat(),
                "expires_at": expires.isoformat(),
                "split": split,
                "direction": assessment.direction,
                "outcome": outcome,
                "matched": matched,
                "entry": str(entry.open),
                "settlement": str(end.open),
                "episode": episode,
                "input_sha256": assessment.input_sha256,
            }
        )
    cohorts: dict[str, object] = {}
    for name in ("development", "validation", "holdout"):
        subset = [row for row in rows if row["split"] == name]
        resolved = [row for row in subset if row["outcome"] in ("up", "down")]
        wins = sum(row["matched"] is True for row in resolved)
        balance, peak, drawdown, streak, longest = Decimal(0), Decimal(0), Decimal(0), 0, 0
        for row in resolved:
            won = row["matched"] is True
            streak = 0 if won else streak + 1
            longest = max(longest, streak)
            if payout is not None:
                balance += payout if won else -1
                peak = max(peak, balance)
                drawdown = max(drawdown, peak - balance)
        cohorts[name] = {
            "signals": len(subset),
            "resolved_non_ties": len(resolved),
            "matched": wins,
            "ties": sum(row["outcome"] == "tie" for row in subset),
            "missing": sum(row["outcome"] == "missing" for row in subset),
            "observed_match_fraction": wins / len(resolved) if resolved else None,
            "wilson_95_descriptive_only": wilson(wins, len(resolved)),
            "longest_failure_streak": longest,
            "hypothetical_net_units": str(balance) if payout is not None else None,
            "hypothetical_max_drawdown_units": str(drawdown) if payout is not None else None,
        }
    # Bound peak memory for six-month minute histories; hash one canonical JSON line at a time.
    digest = hashlib.sha256()
    for bar in bars:
        digest.update(json.dumps(bar.model_dump(mode="json"), separators=(",", ":")).encode())
        digest.update(b"\n")
    fingerprint = digest.hexdigest()
    return {
        "version": VERSION,
        "horizon_minutes": horizon,
        "input_sha256": fingerprint,
        "start": first.isoformat(),
        "end": last.isoformat(),
        "bars": len(bars),
        "validation_status": "unvalidated",
        "settlement_basis_verified": False,
        "entry_delay_seconds": 60,
        "settlement_basis": "next_minute_index_open_proxy",
        "payout_assumption": str(payout) if payout is not None else None,
        "break_even_probability": str(break_even_probability(payout))
        if payout is not None
        else None,
        "evaluated_decisions": considered,
        "distinct_nonoverlapping_signals": len(rows),
        "coverage": len(rows) / considered if considered else None,
        "rejection_counts": reasons,
        "chronological_cohorts": cohorts,
        "same_signal_time_baselines": baseline,
        "signals": rows,
        "limitations": [
            "Minute index opens are not actual Event Contract fills/settlements.",
            "No live payout history or calibrated probability is available.",
            "Stored candles/calendar are current-vintage, not revision-vintage archives.",
            "Wilson intervals do not correct serial/cross-asset dependence.",
            "Frozen hypothesis: no parameter optimization or profitability acceptance claim.",
        ],
    }
