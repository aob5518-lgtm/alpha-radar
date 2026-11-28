"use client";

import type {
  AlertConfiguration,
  IntentAlert,
  PushDevice,
} from "@alpha-radar/types/event-alerts";
import { useEffect, useState } from "react";
import { useEventAlerts, vibrate } from "@/components/event-alert-provider";
import {
  alertRequest,
  intentHref,
  validIntent,
  type Preferences,
} from "@/lib/event-alerts";
import type { Locale } from "@/lib/i18n/config";
import Link from "next/link";

const deviceKey = "alpha-radar-push-device";
const button = "min-h-11 rounded border px-3 py-1 text-sm disabled:opacity-50";

function rememberDevice(id?: string) {
  try {
    if (id) localStorage.setItem(deviceKey, id);
    else localStorage.removeItem(deviceKey);
  } catch {
    // Push still works if browser storage preferences cannot be persisted.
  }
}

function encode(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function applicationKey(value: string) {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
}

export function EventAlertSettings({
  locale,
  monitoring,
}: {
  locale: Locale;
  monitoring: boolean;
}) {
  const alerts = useEventAlerts();
  const { enabled, token, preferences, audioReady } = alerts;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [vibration, setVibration] = useState(false);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [history, setHistory] = useState<IntentAlert[]>([]);
  const t = (zh: string, en: string) => (locale === "zh-CN" ? zh : en);
  const device = devices.find((candidate) => candidate.id === deviceId);

  useEffect(() => {
    if (!enabled || !token) return;
    function capability() {
      setPermission(
        typeof Notification === "undefined"
          ? "unsupported"
          : Notification.permission,
      );
      setPushAvailable(
        isSecureContext &&
          "serviceWorker" in navigator &&
          "PushManager" in window,
      );
      setVibration(typeof navigator.vibrate === "function");
      void navigator.serviceWorker
        ?.getRegistration()
        .then((registration) => registration?.pushManager?.getSubscription())
        .then((subscription) => setSubscribed(Boolean(subscription)))
        .catch(() => setSubscribed(false));
    }
    capability();
    try {
      const saved = localStorage.getItem(deviceKey);
      if (validIntent(saved)) setDeviceId(saved);
    } catch {
      // Browser storage is optional.
    }
    window.addEventListener("focus", capability);
    document.addEventListener("visibilitychange", capability);
    const abort = new AbortController();
    async function fetchStatus() {
      if (document.visibilityState !== "visible") return;
      try {
        const options = { signal: abort.signal };
        const [config, current, recent] = await Promise.all([
          alertRequest<AlertConfiguration>(token, "/config", options),
          alertRequest<PushDevice[]>(token, "/devices", options),
          open
            ? alertRequest<IntentAlert[]>(token, "?history=true", options)
            : Promise.resolve([]),
        ]);
        if (!abort.signal.aborted) {
          setKey(config.vapid_public_key);
          setDevices(current);
          setHistory(recent);
        }
      } catch {
        if (!abort.signal.aborted) setStatus("unavailable");
      }
    }
    void fetchStatus();
    const timer = setInterval(() => void fetchStatus(), 8000);
    return () => {
      window.removeEventListener("focus", capability);
      document.removeEventListener("visibilitychange", capability);
      abort.abort();
      clearInterval(timer);
    };
  }, [enabled, token, open]);

  async function enroll(detailed: boolean) {
    if (!key || !pushAvailable || busy) return;
    setBusy(true);
    setStatus("");
    let created: PushSubscription | undefined;
    try {
      const granted =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") return;
      await navigator.serviceWorker.register("/event-alert-sw.js", {
        type: "module",
        scope: "/",
      });
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (
        subscription?.options.applicationServerKey &&
        encode(subscription.options.applicationServerKey) !== key
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(key),
        });
        created = subscription;
      }
      const publicValue = subscription.getKey("p256dh");
      const auth = subscription.getKey("auth");
      if (!publicValue || !auth) throw new Error("Missing keys");
      const saved = await alertRequest<PushDevice>(token, "/devices", {
        method: "POST",
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: encode(publicValue),
          auth: encode(auth),
          label: t("此浏览器", "This browser"),
          locale,
          detailed,
        }),
      });
      if (deviceId && deviceId !== saved.id) {
        await alertRequest(token, "/devices/" + deviceId, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      rememberDevice(saved.id);
      setDeviceId(saved.id);
      setSubscribed(true);
      setDevices((items) => [
        saved,
        ...items.filter((item) => item.id !== saved.id && item.id !== deviceId),
      ]);
      setStatus("subscribed");
    } catch {
      await created?.unsubscribe().catch(() => undefined);
      setStatus("push-failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setStatus("");
    try {
      await alertRequest(token, "/devices/" + id, { method: "DELETE" });
      setDevices((items) => items.filter((item) => item.id !== id));
      if (id === deviceId) {
        rememberDevice();
        setDeviceId("");
        setSubscribed(false);
        const registration = await navigator.serviceWorker.getRegistration();
        await (
          await registration?.pushManager.getSubscription()
        )?.unsubscribe();
      }
    } catch {
      setStatus("push-failed");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    alerts.test();
    if (!device?.enabled || !subscribed || !key) return;
    setBusy(true);
    try {
      const result = await alertRequest<{ provider_accepted: boolean }>(
        token,
        "/devices/" + device.id + "/test",
        {
          method: "POST",
          body: "{}",
        },
      );
      setStatus(result.provider_accepted ? "accepted" : "push-failed");
    } catch {
      setStatus("push-failed");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  const pushReady = Boolean(
    pushAvailable &&
      key &&
      subscribed &&
      device?.enabled &&
      permission === "granted",
  );
  const controls: [keyof Preferences, string][] = [
    ["popup", t("弹窗提醒", "Foreground popups")],
    ["sound", t("声音提醒", "Sound")],
    ["vibration", t("震动提醒", "Vibration")],
  ];
  const statuses = {
    unavailable: t(
      "提醒服务暂不可用。",
      "Alert service is temporarily unavailable.",
    ),
    subscribed: t("此浏览器已订阅。", "This browser is subscribed."),
    accepted: t(
      "推送服务已接收测试提醒。请在设备上确认。",
      "The push provider accepted the test. Check your device.",
    ),
    "push-failed": t(
      "推送操作未完成，请检查系统权限后重试。",
      "Push operation failed. Check device permissions and try again.",
    ),
    "audio-failed": t(
      "声音尚未解锁，请检查浏览器设置。",
      "Sound is locked. Check browser settings.",
    ),
    "vibration-requested": t(
      "已请求震动，请在设备上确认。",
      "Vibration requested. Check your device.",
    ),
    "vibration-failed": t(
      "浏览器未接受震动请求。",
      "The browser did not accept the vibration request.",
    ),
  };
  const labels = {
    none: t("仅前台", "Foreground only"),
    queued: t("待发送", "Queued"),
    accepted: t("推送服务已接收", "Provider accepted"),
    failed: t("发送失败", "Failed"),
    cancelled: t("已停止发送", "Cancelled"),
    expired: t("已过期", "Expired"),
  };
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="space-y-3 rounded-md border bg-[var(--panel)] p-3"
    >
      <summary className="cursor-pointer text-sm">
        {t("提醒设置", "Alert settings")} ·{" "}
        {monitoring
          ? t("监控中", "Monitoring")
          : t("监控暂停", "Monitoring paused")}
        {" · "}
        {t("弹窗", "Popup")} {preferences.popup ? "✓" : "—"}
        {" · "}
        {t("声音", "Sound")} {preferences.sound && audioReady ? "✓" : "—"}
        {" · "}
        {t("推送", "Push")} {pushReady ? "✓" : "—"}
      </summary>
      <div className="flex flex-wrap gap-4">
        {controls.map(([name, label]) => (
          <label key={name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={preferences[name]}
              disabled={name === "vibration" && !vibration}
              onChange={(event) =>
                alerts.update({ ...preferences, [name]: event.target.checked })
              }
            />
            {label}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={device?.detailed ?? false}
            disabled={!pushReady || busy}
            onChange={(event) => void enroll(event.target.checked)}
          />
          {t("锁屏显示详细内容", "Show details on lock screen")}
        </label>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {audioReady
          ? t("声音已解锁", "Sound unlocked")
          : t("声音需要点按解锁", "Tap to unlock sound")}
        {" · "}
        {vibration
          ? t("支持网页震动", "Web vibration supported")
          : t("当前设备不支持网页震动", "Web vibration unavailable")}
        {" · "}
        {permission === "granted"
          ? t("通知已授权", "Notifications allowed")
          : permission === "denied"
            ? t(
                "通知已拒绝，请检查系统或浏览器设置",
                "Notifications blocked. Check OS or browser settings.",
              )
            : t(
                "通知未授权或不可用",
                "Notification permission not granted or unavailable",
              )}
        {" · "}
        {pushReady
          ? t("此设备已订阅", "This device is subscribed")
          : t("此设备未启用推送", "Push inactive on this device")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          onClick={() => {
            alerts.update({ ...preferences, popup: true, sound: true });
            void alerts
              .unlockAudio()
              .then((ready) => setStatus(ready ? "" : "audio-failed"));
          }}
        >
          {t("开启提醒", "Enable alerts")}
        </button>
        <button
          type="button"
          className={button}
          onClick={() =>
            void alerts
              .sound()
              .then((ready) => setStatus(ready ? "" : "audio-failed"))
          }
        >
          {t("测试声音", "Test sound")}
        </button>
        <button
          type="button"
          className={button}
          disabled={!vibration}
          onClick={() =>
            setStatus(vibrate() ? "vibration-requested" : "vibration-failed")
          }
        >
          {t("测试震动", "Test vibration")}
        </button>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void test()}
        >
          {t("测试提醒", "Test alert")}
        </button>
        {pushReady && device ? (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void remove(device.id)}
          >
            {t("关闭手机推送", "Disable push")}
          </button>
        ) : (
          <button
            type="button"
            className={button}
            disabled={busy || !key || !pushAvailable || permission === "denied"}
            onClick={() => void enroll(false)}
          >
            {t("开启手机推送", "Enable mobile push")}
          </button>
        )}
      </div>
      {status && (
        <p role="status" className="text-sm">
          {statuses[status as keyof typeof statuses]}
        </p>
      )}
      <p className="text-xs text-[var(--muted)]">
        {t(
          "iPhone（iOS 16.4+）：Safari → 分享 → 添加到主屏幕 → 从主屏幕打开 → 开启手机推送 → 允许通知。Android 在兼容浏览器内开启。后台声音和震动由系统控制。",
          "iPhone (iOS 16.4+): Safari → Share → Add to Home Screen → open the app from Home Screen → Enable mobile push → Allow. On Android, use a compatible browser. The OS controls background sound and vibration.",
        )}
      </p>
      {devices.length > 0 && (
        <ul className="space-y-1 text-xs">
          {devices.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <span>
                {item.label} ·{" "}
                {item.enabled
                  ? t("已启用", "Enabled")
                  : t("已失效", "Inactive")}
                {item.id === deviceId ? " ✓" : ""}
              </span>
              <button
                type="button"
                className="min-h-8 underline"
                disabled={busy}
                onClick={() => void remove(item.id)}
              >
                {t("移除", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2 className="text-sm font-semibold">
        {t("近期提醒", "Recent alerts")}
      </h2>
      {history.length ? (
        <ul className="space-y-2 text-xs">
          {history.map((item) => (
            <li key={item.intent_id}>
              <Link
                prefetch={false}
                href={intentHref(item.intent_id)}
                className="underline"
              >
                {new Date(item.created_at).toLocaleString(locale)} ·{" "}
                {item.symbol} · {item.horizon_minutes}m ·{" "}
                {item.direction.toUpperCase()}
              </Link>
              {" · "}
              {labels[item.push_status]}
              {" · "}
              {item.opened_at ? t("已打开", "Opened") : t("未打开", "Unopened")}
              {Date.parse(item.expires_at) <= Date.now() &&
                item.push_status !== "expired" &&
                " · " + t("已过期", "Expired")}
              {item.dispatch_ms !== null &&
                " · " +
                  t("发送用时", "Dispatch") +
                  " " +
                  item.dispatch_ms +
                  " ms"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {t("暂无提醒记录", "No alerts recorded")}
        </p>
      )}
    </details>
  );
}
