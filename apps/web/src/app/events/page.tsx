import { EventsWorkspace } from "@/components/events-workspace";
import { getEvents } from "@/lib/api/events";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const { locale, messages } = await getTranslations();
  const events = await getEvents({
    importance: ["critical", "high", "medium"],
    pageSize: 100,
  }).catch(() => ({ items: [] }));
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-4 sm:px-7">
      <h1 className="mb-3 text-xl font-semibold">{messages.nav.events}</h1>
      <div className="border bg-[var(--panel)]">
        <EventsWorkspace events={events.items} locale={locale} />
      </div>
    </main>
  );
}
