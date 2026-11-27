import { notFound } from "next/navigation";

import { EventSimulator } from "@/components/event-simulator";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EventSimulatorPage() {
  if (process.env.EVENT_SIMULATOR_ENABLED !== "true") notFound();
  const { locale, messages } = await getTranslations();
  return (
    <EventSimulator
      locale={locale}
      copy={messages.eventSimulator}
      shadow={messages.chart.eventContracts.shadow}
    />
  );
}
