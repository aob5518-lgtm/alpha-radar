import { DemoBadge } from "@/components/demo-badge";
import { RadarWorkspace } from "@/components/radar/radar-workspace";
import { getTranslations } from "@/lib/i18n/server";

export default async function RadarPage() {
  const { locale, messages } = await getTranslations();

  return (
    <main className="page-shell">
      <div className="flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="section-label">{messages.radar.eyebrow}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
            {messages.radar.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {messages.radar.description}
          </p>
        </div>
        <DemoBadge label={messages.common.demoData} />
      </div>
      <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100">
        {messages.common.demoDisclaimer}
      </div>
      <div className="mt-6">
        <RadarWorkspace locale={locale} messages={messages} />
      </div>
    </main>
  );
}
