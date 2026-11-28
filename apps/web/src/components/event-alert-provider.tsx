"use client";

import type { IntentAlert } from "@alpha-radar/types/event-alerts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { claimAlert } from "../../public/event-alert-dedup.js";
import {
  activeAlerts,
  alertRequest,
  defaultPreferences,
  intentHref,
  validIntent,
  type Preferences,
} from "@/lib/event-alerts";
import type { Locale } from "@/lib/i18n/config";

const preferenceKey = "alpha-radar-alert-preferences";
type Notice = IntentAlert | "test";
type Context = {
  enabled: boolean;
  token: string;
  setToken: (token: string) => void;
  preferences: Preferences;
  update: (value: Preferences) => void;
  audioReady: boolean;
  unlockAudio: () => Promise<boolean>;
  sound: () => Promise<boolean>;
  test: () => void;
};
const AlertContext = createContext<Context | null>(null);
export function useEventAlerts() {
  const context = useContext(AlertContext);
  if (!context) throw new Error("Missing alert provider");
  return context;
}

export function vibrate() {
  return (
    typeof navigator.vibrate === "function" &&
    navigator.vibrate([200, 100, 200])
  );
}

export function EventAlertProvider({
  enabled,
  locale,
  children,
}: {
  enabled: boolean;
  locale: Locale;
  children: ReactNode;
}) {
  const [token, saveToken] = useState("");
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [now, setNow] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const fallback = useRef(new Map<string, number>());
  const router = useRouter();
  const t = (zh: string, en: string) => (locale === "zh-CN" ? zh : en);

  function setToken(value: string) {
    saveToken(value);
    setNotices([]);
  }

  function update(value: Preferences) {
    setPreferences(value);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(value));
    } catch {
      // Preferences remain available for this session.
    }
  }

  async function unlockAudio() {
    try {
      audio.current ??= new AudioContext();
      const context = audio.current;
      context.onstatechange = () => setAudioReady(context.state === "running");
      // Some browsers leave resume pending when activation is denied.
      await Promise.race([
        context.resume(),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
      setAudioReady(context.state === "running");
      return context.state === "running";
    } catch {
      setAudioReady(false);
      return false;
    }
  }

  function play() {
    const context = audio.current;
    if (!context || context.state !== "running") return false;
    for (const [index, hz] of [740, 880, 1040].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.16;
      oscillator.frequency.value = hz;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.025);
      gain.gain.linearRampToValueAtTime(0, start + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.13);
    }
    return true;
  }

  function test() {
    setNotices((items) => ["test", ...items.filter((item) => item !== "test")]);
    if (preferences.sound) play();
    if (preferences.vibration) vibrate();
  }

  useEffect(() => {
    if (!enabled) return;
    function load() {
      try {
        const value = JSON.parse(
          localStorage.getItem(preferenceKey) ?? "{}",
        ) as Partial<Preferences>;
        setPreferences({
          popup: value.popup !== false,
          sound: value.sound === true,
          vibration: value.vibration === true,
        });
      } catch {
        setPreferences(defaultPreferences);
      }
    }
    function claim(event: StorageEvent) {
      if (event.key === preferenceKey) load();
    }
    function navigate(event: MessageEvent) {
      if (event.data?.type === "event-alert-open") {
        router.push(
          validIntent(event.data.intent)
            ? intentHref(event.data.intent)
            : "/event-contracts",
        );
        event.ports[0]?.postMessage(true);
      }
    }
    load();
    window.addEventListener("storage", claim);
    navigator.serviceWorker?.addEventListener("message", navigate);
    return () => {
      window.removeEventListener("storage", claim);
      navigator.serviceWorker?.removeEventListener("message", navigate);
    };
  }, [enabled, router]);

  useEffect(() => {
    if (
      !enabled ||
      !token ||
      (!preferences.popup && !preferences.sound && !preferences.vibration)
    )
      return;
    const controller = new AbortController();
    let polling = false;
    async function poll() {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      try {
        const items = await alertRequest<IntentAlert[]>(token, "", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const current = Date.now();
        setNow(current);
        const candidates = activeAlerts(items, current);
        const live = new Set(candidates.map((item) => item.intent_id));
        setNotices((items) =>
          items.filter((item) => item === "test" || live.has(item.intent_id)),
        );
        const queue: IntentAlert[] = [];
        for (const item of candidates) {
          const until = Date.parse(item.expires_at);
          function claim(id: string) {
            return claimAlert(id, until).catch(() => {
              const seen = fallback.current;
              for (const [id, expiry] of seen)
                if (expiry <= current) seen.delete(id);
              if (seen.has(id)) return false;
              seen.set(id, until);
              return true;
            });
          }
          const wantsAttention =
            (preferences.sound && audio.current?.state === "running") ||
            (preferences.vibration && typeof navigator.vibrate === "function");
          const show =
            preferences.popup && (await claim(item.intent_id + ":popup"));
          const attention = wantsAttention && (await claim(item.intent_id));
          if (
            controller.signal.aborted ||
            document.visibilityState !== "visible"
          )
            return;
          if (until <= Date.now()) continue;
          if (show) queue.push(item);
          if (attention) {
            if (preferences.sound) play();
            if (preferences.vibration) vibrate();
          }
        }
        if (queue.length) setNotices((items) => [...items, ...queue]);
      } catch (error) {
        if (
          !controller.signal.aborted &&
          error instanceof Error &&
          error.message === "401"
        )
          setToken("");
      } finally {
        polling = false;
      }
    }
    const refresh = setInterval(() => void poll(), 2000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    document.addEventListener("visibilitychange", poll);
    void poll();
    return () => {
      controller.abort();
      clearInterval(refresh);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [enabled, token, preferences]);

  const available = notices.filter(
    (item) => item === "test" || Date.parse(item.expires_at) > now,
  );
  const notice = available[0];
  function close() {
    setNotices((items) => items.filter((item) => item !== notice));
  }
  return (
    <AlertContext.Provider
      value={{
        enabled,
        token,
        setToken,
        preferences,
        update,
        audioReady,
        unlockAudio,
        sound: async () => (await unlockAudio()) && play(),
        test,
      }}
    >
      {children}
      {enabled && token && notice && (
        <aside
          role="status"
          className="fixed right-3 bottom-3 z-50 w-[min(25rem,calc(100%-1.5rem))] rounded-lg border bg-[var(--panel)] p-4 text-sm shadow-2xl"
        >
          <p className="font-semibold">
            {notice === "test"
              ? t(
                  "测试提醒 · 非真实策略信号",
                  "Test alert · No strategy signal",
                )
              : t("事件合约 · 新信号", "Event Contracts · New signal")}
            {available.length > 1 && (
              <span className="ml-2">+{available.length - 1}</span>
            )}
          </p>
          {notice !== "test" && (
            <div className="my-2 space-y-1">
              <p>
                {notice.symbol} · {notice.horizon_minutes}
                {t("分钟", "m")}
              </p>
              <p
                className={
                  notice.direction === "higher"
                    ? "text-emerald-300"
                    : "text-rose-300"
                }
              >
                {notice.direction === "higher"
                  ? t("偏涨 HIGHER", "HIGHER")
                  : t("偏跌 LOWER", "LOWER")}
                {" · "}
                {t("证据分", "Evidence score")} {notice.score} / 100
              </p>
              <p>
                {t("剩余", "Expires in")}{" "}
                {Math.max(
                  0,
                  Math.ceil((Date.parse(notice.expires_at) - now) / 1000),
                )}
                {t(" 秒", "s")}
                {!notice.execution_enabled &&
                  " · " + t("仅监控", "Monitoring only")}
              </p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {notice !== "test" && (
              <Link
                prefetch={false}
                href={intentHref(notice.intent_id)}
                onClick={close}
                className="rounded border border-emerald-400 px-3 py-2 text-emerald-300"
              >
                {t("查看信号", "Review signal")}
              </Link>
            )}
            <button
              type="button"
              onClick={close}
              className="rounded border px-3 py-2"
            >
              {t("关闭提醒", "Dismiss alert")}
            </button>
          </div>
        </aside>
      )}
    </AlertContext.Provider>
  );
}
