import { claimAlert } from "./event-alert-dedup.js";

const validId = (id) =>
  typeof id === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      if (!payload || typeof payload.body !== "string") return;
      const test = payload.test === "true";
      const id = test ? null : payload.intent;
      const expires = Date.parse(payload.expires);
      if (
        !test &&
        (!validId(id) || !Number.isFinite(expires) || expires <= Date.now())
      )
        return;
      const fresh = test || (await claimAlert(id, expires).catch(() => true));
      await self.registration.showNotification("ALPHA RADAR", {
        body: payload.body.slice(0, 160),
        tag: test ? "alpha-radar-test" : id,
        silent: !fresh,
        renotify: false,
        icon: "/event-alert-icon/192",
        data: { intent: id },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.intent;
  const path = validId(id)
    ? "/event-contracts?intent=" + id
    : "/event-contracts";
  event.waitUntil(
    (async () => {
      const url = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing =
        windows.find((client) => client.url === url) ??
        windows.find((client) => client.visibilityState === "visible") ??
        windows[0];
      if (existing) {
        await existing.focus();
        if (existing.url === url) return;
        const channel = new MessageChannel();
        const accepted = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 450);
          channel.port1.onmessage = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          existing.postMessage(
            { type: "event-alert-open", intent: validId(id) ? id : null },
            [channel.port2],
          );
        });
        channel.port1.close();
        if (!accepted) await existing.navigate(url);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
