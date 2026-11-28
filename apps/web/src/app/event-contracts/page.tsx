import { notFound } from "next/navigation";

import { EventSimulator } from "@/components/event-simulator";
import { EventContractModes } from "@/components/event-contract-modes";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function EventSimulatorPage() {
  if (process.env.EVENT_SIMULATOR_ENABLED !== "true") notFound();
  const { locale, messages } = await getTranslations();
  const paper = (
    <EventSimulator
      locale={locale}
      copy={messages.eventSimulator}
      shadow={messages.chart.eventContracts.shadow}
    />
  );
  return process.env.EVENT_SEMI_AUTO_AVAILABLE === "true" ? (
    <EventContractModes
      locale={locale}
      copy={messages.chart.eventContracts.shadow}
    >
      {paper}
    </EventContractModes>
  ) : (
    paper
  );
}
