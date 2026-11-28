# Alpha Radar Mac Executor V1

For the native mirroring diagnostics in the current companion, see [Mac Executor V2](MAC_EXECUTOR_V2.md).

Feasibility conclusion **PARTIALLY_SUPPORTED**. The operator reported successful manual
interaction with Binance through iPhone Mirroring. On November 29, 2026 (Asia/Kuala Lumpur),
an Apple Silicon Mac running macOS 27.2.1 exposed one on-screen iPhone Mirroring window.
The probe process had screen-capture permission, and ScreenCaptureKit also listed one
shareable Mirroring window. Accessibility trust for the probe was false. The probe reads
window metadata and permission state. Device connection, lock, authentication, in-app state,
and financial field readback remain unverified. Physical input testing and order submission
were skipped.

Apple documents manual click, scroll, and typing through [iPhone Mirroring](https://support.apple.com/en-us/120421),
and general window enumeration through
[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/scshareablecontent).
The Binance [Event Contracts FAQ](https://www.binance.com/en/support/faq/detail/172247f1c4b8401ab106fb63900f3825)
documents manual app use and lists the Android and iOS apps as the available interfaces
in its API section. The [Event Contracts Terms](https://www.binance.com/en/about-legal/terms-event-contracts)
incorporate the [Binance Terms of Use](https://www.binance.com/en/terms). The published
[Prohibited Use Policy, section I](https://bin.bnbstatic.com/static/cms/cg08ou2ak0tn7mcplvfg/file/3c287bd60863eccef6a16b8580190c96d4c9414931928d7fafdb227bf967cd63.pdf)
restricts automated access or monitoring unless expressly permitted. No applicable express
permission for programmatic access via iPhone Mirroring was established. Requests from the
test Mac to the Binance FAQ and Terms timed out. The public documents were reviewed separately.
This release keeps ASSISTED disabled.

## Install and observe

Use macOS 15+ with Swift 6 from Xcode or the Command Line Tools. From the repository root:

```sh
mkdir -p "$HOME/Applications"
bash tools/mac-companion/package-app.sh "$HOME/Applications"
open "$HOME/Applications/Alpha Radar Mac Executor.app"
```

The packaging script creates a local ad-hoc signed app and preserves an existing installation.
For troubleshooting, run `swift run --package-path tools/mac-companion MirroringProbe` inside
the active Mac session. It reports permission status and window counts. Screen & System Audio
Recording permission, if needed for the probe, is managed in macOS Privacy & Security.
The panel needs neither screen recording nor Accessibility permission for OBSERVE or DRY_RUN.
System permission prompts are left to the operator.

In OBSERVE, enter your approved Alpha Radar HTTPS origin, then generate a device pairing
fingerprint. The Mac saves a random 256-bit credential in its local Keychain. The fingerprint
in the panel is the SHA-256 digest. Add it to the API environment as
`MAC_EXECUTOR_DEVICE_TOKEN_SHA256` and set `MAC_EXECUTOR_OBSERVE_ENABLED=true`.
The main Alpha Radar HTTPS origin uses the existing web proxy for
`GET /api/v1/event-semi-auto/mac-executor/observation`. Semi-Auto availability and Shadow must already
be enabled. Recreate the API service to pick up settings. One device credential is supported per
installation. To revoke it, clear the digest or disable the observer and reload the API.
The local remove button clears the Keychain entry. Pairing leaves the live execution flag independent.

The client polls about every three seconds after a response. It uses normal TLS validation, an
ephemeral URL session, an explicit request timeout and response limit, and rejects redirects.
The private response has no-store caching. The server reads the existing intent and checks
current risk, the kill switch, exact signal identity, the original deadline and unresolved handoffs
in a read-only snapshot. The device credential is scoped to this single GET route. No database
migration or live adapter changes are needed. An alert is local and audible. The panel clears
the visible intent on stop, loss of a valid response, expiry, or mode change.

## Dry-run

Open DRY_RUN and load a BTC or ETH fixture for 10m or 30m. The panel displays
**SIMULATION ONLY**. Change the observed market, horizon, direction, premium, payout, or
simulated ATR drift to exercise readback. Use the fault toggles to test the offline emergency
stop, a disconnected device, stale signal, the server kill switch, or an unexpected dialog.
Verify the fields, then submit the local confirmation. Confirmation repeats validation. Success,
rejection, timeout and unknown outcomes are selectable. A timeout, unknown result or incomplete
local claim requires reconciliation and cannot re-run the same fixture.

An atomic directory creation claims each fixture UUID. A single outcome file records its
result across process restarts in the local application-support directory. DRY_RUN uses the
local journal and has no provider, network, or real ledger integration. The existing
manual reconciliation flow remains authoritative for actual orders.

## Verification

```sh
swift run --package-path tools/mac-companion ExecutorCoreChecks
swift build --package-path tools/mac-companion -c release
```

The mock tests cover the four market/horizon combinations, both directions, exact readback,
payout/drift, expiry, permissions, modal, disconnect, stop controls, duplicate and concurrent
claims, interrupted-claim recovery, simulated rejection and uncertain outcomes.
Backend checks cover credential scope and revocation. Disposable PostgreSQL integration exercises
reused intent eligibility, expiry, the kill switch and existing ledger behavior.

The SHA-256 of the Git tree listing for Event Signal, Paper, and the existing Semi-Auto rules,
schemas, service, adapter, execution contract, lifecycle, models, and repository was
`ea0b1768ef599d5ca386c486190e1c74e93d49d6a1f649b93056a54d5e2f584a` at both the base and PR.

The panel reports observed signal-to-Mac receipt latency when a paired server delivers an intent.
The local mock reports elapsed time through order-review readiness, including operator interaction.
One Mac UI smoke test directly observed BTC 10m review and simulated success. The panel
reported 5,649 ms to review in that sample, including the tester's interaction time.
Measured physical GUI preparation and operator-confirmation latency are unavailable.

## Remaining assisted-execution gates

Establish product/account authorization and verify reliable, independently observed physical
states for connected, disconnected, locked, authentication, wrong application, unexpected
modal, order review, and result reconciliation. Verify exact contract and displayed financial
terms, deadline handling and end-to-end latency on the operator’s devices. A separate review
must cover any real device claim, the existing PostgreSQL idempotency boundary, and any
execution mode beyond read-only observation. The app exposes neither remote GUI controls nor
a real submit action.
