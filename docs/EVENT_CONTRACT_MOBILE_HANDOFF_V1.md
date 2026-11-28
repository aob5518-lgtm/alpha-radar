# Event Contract Mobile Handoff V1

The Semi-Auto mobile card shows the frozen premium, direction, horizon, minimum
payout, score, reference price and time remaining. Its confirmation sheet opens
the official Binance app entry. The Binance Event Contracts help article
documents **Binance App → Futures → Events**. The public app entry offers Binance
mobile app distribution. Public documentation reviewed for this release did not
provide a supported Event Contract link or contract-prefill parameters.

- [Binance Event Contracts FAQ](https://www.binance.com/en/support/faq/detail/172247f1c4b8401ab106fb63900f3825)
- [Official Binance app entry](https://www.binance.com/en/download)

On iOS Safari or Android Chrome, the entry may first open as a web page.
Use the installed Binance App and follow the on-screen Futures → Events
instructions. Direct native launch depends on device and region. Radar sends
a fixed URL without parameters. Native app launch requires physical-device
verification.

## Recovery and execution records

The existing authorized decision route checks the original risk rules before
writing one handoff timestamp under the ledger lock. The frozen intent stores
the signal and risk snapshot. Repeating the handoff request returns the same
timestamp. The clipboard contains market, horizon, direction, suggested premium
and minimum payout. Clipboard permission failure does not block navigation.

Foreground and page lifecycle events reload the private server state and record
the first observed return. Unlock again after a refresh if browser memory was
cleared. The current view shows up to 25 unresolved handoffs, newest first.
Expiration preserves started handoffs. Manual reporting requires a handoff
started before expiry. Historical reports flag below-policy payout, acknowledged
direction or horizon differences, and reporting after signal expiry. The
existing open-bet identity constraint applies. Settle any existing record that
blocks another record for the same instrument and horizon.

The operator reports execution and settlement. Absolute price drift uses the
actual open and frozen reference. Percentage drift divides by the signal
reference and ATR drift uses the signal-time ATR. Latency uses server handoff
time and user-reported actual open time. Median and nearest-rank P90 use recorded
mobile executions. Handoff counts measure authorized launch attempts.

Migration 20261128_0012 adds UTC handoff and return times, execution
disclosures, drift and latency. The operator token remains in memory and
authorizes requests to Alpha Radar only. Binance handles sign-in and order
confirmation directly in its app.
