from hashlib import sha256
from pathlib import Path

import pytest

from alpha_radar.event_semi_auto.execution_adapters import adapter_for
from alpha_radar.event_semi_auto.execution_contract import AdapterKind
from alpha_radar.event_semi_auto.execution_lifecycle import transition
from alpha_radar.event_semi_auto.models import LiveIntent

SOURCE = Path(__file__).resolve().parents[1] / "src" / "alpha_radar"


@pytest.mark.parametrize(
    ("module", "fingerprint"),
    [
        ("event_contracts", "02a54de8454a1594841d4ed141623f997c0ad182f577507a0d03fba998ea4ecb"),
        ("event_simulator", "75422d14e4e8a2ff11160fe38ae48ee94bc603f6b105a9fe5cadf4e7a14f1249"),
    ],
)
def test_execution_release_keeps_strategy_and_paper_frozen(module: str, fingerprint: str) -> None:
    # Pinned from the production base 3ad750f. Rebaseline only for an approved model change.
    files = sorted((SOURCE / module).rglob("*.py"))
    hashes = "".join(f"{sha256(path.read_bytes()).hexdigest()}\n" for path in files)
    assert sha256(hashes.encode()).hexdigest() == fingerprint


@pytest.mark.parametrize("kind", ["MANUAL", "MOBILE_HANDOFF", "RESEARCH_DISABLED"])
def test_adapter_registry_has_no_fallback(kind: AdapterKind) -> None:
    adapter = adapter_for(kind)
    assert adapter.kind == kind
    assert adapter.availability() is (kind != "RESEARCH_DISABLED")
    assert adapter.health().healthy is adapter.availability()


def test_reconciliation_cannot_return_to_execution() -> None:
    intent = LiveIntent(execution_status="RECONCILIATION_REQUIRED")
    with pytest.raises(ValueError, match="Invalid execution transition"):
        transition(intent, "EXECUTING")
    transition(intent, "EXECUTED")
    transition(intent, "SETTLED")
    assert intent.execution_status == "SETTLED"
