from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from statistics import mean, median

from alpha_radar.event_contracts.shadow_rules import Direction, Regime, Result
from alpha_radar.event_contracts.strategy import Horizon


@dataclass(frozen=True, slots=True)
class Observation:
    symbol: str
    horizon: Horizon
    at: datetime
    direction: Direction
    result: Result
    score: int | None
    regime: Regime | None
    tied: bool = False


def score_bucket(score: int | None) -> str:
    if score is None:
        return "unscored"
    if score >= 90:
        return "90+"
    lower = score // 5 * 5
    return f"{lower}–{lower + 4}"


def summarize(observations: list[Observation]) -> dict[str, int | float | None]:
    rows = sorted(observations, key=lambda item: item.at)
    wins = losses = streak = longest = 0
    for item in rows:
        if item.result == "win":
            wins += 1
            streak = 0
        elif item.result == "loss":
            losses += 1
            streak += 1
            longest = max(longest, streak)
        else:
            streak = 0
    scores = [item.score for item in rows if item.score is not None]
    return {
        "signals": len(rows),
        "wins": wins,
        "losses": losses,
        "missing": sum(item.result == "missing" for item in rows),
        "pending": sum(item.result == "pending" for item in rows),
        "ties_counted_as_losses": sum(item.tied for item in rows),
        "win_rate": wins / (wins + losses) if wins + losses else None,
        "max_consecutive_losses": longest,
        "average_score": mean(scores) if scores else None,
        "median_score": median(scores) if scores else None,
    }


def grouped(rows: list[Observation]) -> dict[str, object]:
    groups: dict[str, dict[str, list[Observation]]] = {
        name: defaultdict(list)
        for name in ("market", "direction", "score_bucket", "regime", "joint")
    }
    for item in rows:
        market = f"{item.symbol}/{item.horizon}m"
        bucket = score_bucket(item.score)
        regime = item.regime or "unclassified"
        groups["market"][market].append(item)
        groups["direction"][f"{market}/{item.direction}"].append(item)
        groups["score_bucket"][f"{market}/{bucket}"].append(item)
        groups["regime"][f"{market}/{regime}"].append(item)
        groups["joint"][f"{market}/{item.direction}/{bucket}/{regime}"].append(item)
    return {
        "overall": summarize(rows),
        **{
            name: {key: summarize(value) for key, value in sorted(group.items())}
            for name, group in groups.items()
        },
    }
