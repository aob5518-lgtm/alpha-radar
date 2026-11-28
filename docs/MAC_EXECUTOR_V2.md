# Alpha Radar Mac Executor V2

V2 extends the packaged Mac Companion with native iPhone Mirroring diagnostics and a single
local test action. The production device credential remains scoped to the existing read-only
observation endpoint. A cloud intent cannot invoke the GUI driver. ASSISTED and AUTO are locked.

## Physical device check

1. Install the app using `tools/mac-companion/package-app.sh` and keep the previous app for rollback.
   Open V2 with the exact path of the installed app.
2. In macOS Privacy & Security, grant the installed app Accessibility and Screen & System Audio
   Recording. On newer macOS versions, the Accessibility control may appear as **Device Control
   and Data Access**. If an ad hoc build was replaced and the companion still reports a missing
   permission, remove its old entry and add the current app in that pane. Follow the macOS
   relaunch prompt if shown and check both statuses in the companion.
3. Serve `tools/mac-companion/device-test/` on a trusted local network and open it in iPhone
   Safari. Keep the phone in portrait. For example, with both devices on the same Wi-Fi:

   ```sh
   test_ip=$(ipconfig getifaddr en0)
   test -n "$test_ip" && python3 -m http.server 8765 --bind "$test_ip" \
     --directory tools/mac-companion/device-test
   ```

4. Open iPhone Mirroring and display the page with `TAP TEST BUTTON` visible. In the Mac
   companion, select OBSERVE. **Activate** exercises AppKit foreground activation.
   **Read test page** exercises window-only ScreenCaptureKit capture plus Vision OCR without
   input. **Verify test page input** sends one local click and reads a fresh frame independently.
   A passing phone screen displays `IPHONE INPUT RECEIVED`. Reload the phone page manually for
   another attempt. Stop the temporary server when finished.
5. Repeat with the mirror unavailable or another non-financial screen visible. The driver must
   stop. Verify the local Emergency Stop with the network disconnected.

The driver matches the Apple mirror process and checks the exact window, PID, bounds and foreground
app. Two separately captured frames must agree on the fixture and button location. AppKit must
identify the exact mirror window as the mouse-down recipient before the Core Graphics session
click. The post-action capture must read the independent result marker. Capture-to-use freshness
is bounded to one second. Unknown state, changed target, missing permission or absent
acknowledgement stops the attempt. There is no automatic retry. Screenshots and OCR text remain
in memory. Logs contain status and timing.

The packaged app passed the iPhone Safari fixture on November 29, 2026. One click produced the
independently observed `IPHONE INPUT RECEIVED` marker after 295 ms. The app refused input on the
iPhone Home Screen (`unexpectedScreen`) and after mirroring was closed (`unavailable`).

## Production OBSERVE pairing

Follow the existing [production pairing steps](MAC_EXECUTOR_V1.md#install-and-observe). The app
reuses a matching Keychain entry. When no entry exists, use the companion to enroll the Mac and
configure only the digest on the server. Verify a successful response in the companion through
the production HTTPS origin. An authorized `stopped` response demonstrates connectivity and a
closed server gate. A natural actionable intent must be observed separately with the Radar web
page closed. Keep the current strategy and risk settings while testing. Do not insert a live
intent into production for acceptance testing.

## Execution boundary

V1 records the reviewed public Binance policy and the lack of verified express authorization
for programmatic Event Contracts UI access. The Safari test checks the macOS integration and
cannot establish Binance UI support. The provider workflow still requires authorization and
independent live field evidence for market, horizon, direction, premium and displayed payout.
The companion performs no financial submit or ledger write. Existing operator-managed
PostgreSQL claims and reconciliation remain the path for real ledger records.

## Verification

```sh
swift format lint --recursive --strict tools/mac-companion/Package.swift tools/mac-companion/Sources tools/mac-companion/Tests
swift run --package-path tools/mac-companion ExecutorCoreChecks
swift build --package-path tools/mac-companion -c release
```

The workflow checks exercise exact fixture fields, expiry, stop controls, duplicate claims and
interrupted/unknown outcome reconciliation. Native fixture parser tests exercise ambiguous,
conflicting, misplaced and low-confidence visual evidence. The Git tree listing SHA-256 for
`apps/api/src/alpha_radar/{event_contracts,event_simulator,event_semi_auto}` at base and V2 is
`d6f9b147f23e0d0e1b0c44b49976dcd5afc5ebf70fec9bbf550de3a788f85030`.
