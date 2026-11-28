import { notFound } from "next/navigation";

import { EventSimulator } from "@/components/event-simulator";
import { EventContractModes } from "@/components/event-contract-modes";
import { validIntent } from "@/lib/event-alerts";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EventSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string | string[] }>;
}) {
  if (process.env.EVENT_SIMULATOR_ENABLED !== "true") notFound();
  const { locale, messages } = await getTranslations();
  const { intent } = await searchParams;
  const requestedIntent =
    process.env.EVENT_ALERTS_ENABLED === "true" && validIntent(intent)
      ? intent
      : null;
  const paper = (
    <EventSimulator
      locale={locale}
      copy={messages.eventSimulator}
      shadow={messages.chart.eventContracts.shadow}
    />
  );
  return process.env.EVENT_SEMI_AUTO_AVAILABLE === "true" ? (
    <EventContractModes
      key={requestedIntent ?? "overview"}
      requestedIntent={requestedIntent}
      locale={locale}
      copy={messages.chart.eventContracts.shadow}
    >
      {paper}
    </EventContractModes>
  ) : (
    paper
  );
}
