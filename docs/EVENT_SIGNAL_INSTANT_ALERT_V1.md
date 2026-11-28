# Event Signal Instant Alert V1

## Trigger and delivery

The existing Semi-Auto worker applies the existing signal, settings and risk rules. When it
creates a new actionable intent, it inserts an alert and per-device delivery rows in the same
PostgreSQL transaction. The intent UUID is the alert ID. A unique signal-to-intent mapping and
composite delivery keys enforce uniqueness. Enrolling a device does not backfill historical push.
With live execution disabled, these alerts indicate reviewable monitoring signals.

Celery publishes a dispatch task after the intent transaction commits. Beat scans for eligible
work every five seconds as a recovery path. A delivery claim commits before network I/O. The
worker checks the current intent and risk state before each attempt and caps provider TTL at the
existing deadline. It retries at most three times for explicit transient failures and does not
retry ambiguous transport or abandoned in-flight attempts. HTTP 404 and 410 disable the device.

History records the intent and enqueue time, first attempt latency, provider acceptance time and
first successful review opening. Provider acceptance indicates that the provider accepted the
request. Device delivery time is unavailable. The target for the first attempt is under three
seconds when the worker and queue are available. Provider delivery depends on the device and OS.

## Operator setup

Unlock **Event Contracts → Semi-Auto** and open **Alert settings**. Enable foreground popups,
sound or vibration. Use **Enable alerts** or **Test sound** to unlock Web Audio for that browser
session. Vibration needs a browser with the Vibration API and may be blocked by device settings.
The vibration test reports the browser request and asks the operator to verify the device response.

Use **Enable mobile push** from a supported HTTPS installation and grant notification permission.
On iOS/iPadOS 16.4 or newer, open the site in Safari, choose **Share → Add to Home Screen**, launch
from the Home Screen, unlock the panel and enable push there. Web vibration is not available on iOS.
On Android, use a compatible browser and check browser notification permission, OS notification
channels, Do Not Disturb and battery settings. Background sound and vibration belong to the OS.

The push preferences apply per installation. Lock-screen text is generic until detailed content is
enabled for that device. **Test alert** can show a dedicated foreground sample and send a labeled test
push to the current subscribed installation. It creates no signal, intent, bet or strategy outcome.

## Private review and deduplication

The operator token remains in the app layout's React memory across internal navigation. A full
reload or a new installation requires unlock. The same-origin intent UUID in the link survives
unlock. The private lookup shows that intent's current status and the existing action gates apply.
Opening records alert telemetry only. Dismissing a popup affects the popup only.

The foreground fetches a bounded eligible list approximately every two seconds while visible.
IndexedDB arbitrates popup claims between same-origin tabs and attention claims between the app
and service worker. Without IndexedDB the foreground falls back to per-tab deduplication. Provider
topic and OS notification tag use the same stable ID. Browsers may require a visible notification
for each push, so a push after a foreground sound uses a silent, non-renotifying native
notification. Multiple active intents stay in the foreground queue in arrival order.

Device management and history use the existing operator bearer authorization and private,
non-cacheable responses. Subscription endpoints and encryption keys remain in the database and
the submitting browser. The worker only accepts HTTPS Web Push destinations on the supported
Apple, Chromium and Firefox push hosts, does not follow redirects or use proxy environment
settings, and logs provider outcome codes. The service worker handles push and click events
without intercepting or caching API responses.

## Deployment and rollback

Apply Alembic revision `20261129_0014`. Set `EVENT_ALERTS_ENABLED=true` on API, worker and web.
Enable `EVENT_PUSH_ENABLED=true` on API and worker after provisioning the matching P-256 VAPID
public key (uncompressed point) and private key (32-byte scalar), encoded as unpadded base64url.
`WEB_PUSH_VAPID_SUBJECT` uses the actual production HTTPS origin or a monitored mailto address.
Keep the private key in the protected server environment and provision it to API and worker only.
Keep the key stable across releases. Rotating it requires device re-enrollment.

Verify private route authorization, the public-key response, manifest, icons and service worker
over HTTPS. Use a consenting device's test alert to check real delivery, permission, lock-screen
behavior and sound. Automated transport tests do not exercise a physical phone.

Disabling both alert flags stops new outbox records, foreground alerts and sending. Preserve the
database and previous images during release. For rollback to a build predating the additive
migration, start the old API against the migrated database with its automatic Alembic upgrade
overridden. Do not downgrade merely to disable this feature.
