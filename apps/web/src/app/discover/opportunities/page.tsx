import {
  opportunityStages,
  opportunityTypes,
} from "@alpha-radar/types/strategy";
import {
  DemoFilters,
  DemoSelectionNotice,
} from "@/components/strategy/filters";
import {
  OpportunityCard,
  ProductTabs,
  StrategyDisclosure,
  enumLabel,
} from "@/components/strategy/strategy-ui";
import { getTranslations } from "@/lib/i18n/server";
import { localize } from "@/lib/intelligence/demo-data";
import { demoOpportunities, demoThemes } from "@/lib/strategy/demo-data";
import { filterOpportunities } from "@/lib/strategy/derive";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const presentation = await getTranslations();
  const { locale, messages } = presentation;
  const query = await searchParams;
  const first = (key: string) =>
    typeof query[key] === "string" ? query[key] : undefined;
  const items = filterOpportunities(demoOpportunities, {
    themeId: first("theme"),
    stage: first("stage"),
    type: first("type"),
    assetId: first("asset"),
  }).filter(
    (item) => !first("opportunity") || item.id === first("opportunity"),
  );
  return (
    <main className="page-shell">
      <h1 className="text-4xl font-semibold">
        {messages.strategy.opportunities}
      </h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {messages.strategy.opportunityDescription}
      </p>
      <ProductTabs area="discover" messages={messages} />
      <StrategyDisclosure messages={messages} />
      <DemoFilters
        messages={messages}
        resetHref="/discover/opportunities"
        fields={[
          {
            name: "theme",
            label: messages.strategy.theme,
            value: first("theme"),
            options: demoThemes.map((theme) => [
              theme.id,
              localize(theme.name, locale),
            ]),
          },
          {
            name: "stage",
            label: messages.strategy.stage,
            value: first("stage"),
            options: opportunityStages.map((value) => [
              value,
              enumLabel(value, messages),
            ]),
          },
          {
            name: "type",
            label: messages.strategy.type,
            value: first("type"),
            options: opportunityTypes.map((value) => [
              value,
              enumLabel(value, messages),
            ]),
          },
        ]}
      />
      <section className="panel mt-5 p-4">
        <h2 className="section-label">{messages.strategy.lifecycle}</h2>
        <ol className="mt-3 flex flex-wrap gap-2">
          {opportunityStages.map((stage) => (
            <li key={stage} className="data-pill">
              {enumLabel(stage, messages)}
            </li>
          ))}
        </ol>
      </section>
      <DemoSelectionNotice
        empty={!items.length}
        messages={messages}
        resetHref="/discover/opportunities"
      />
      <section className="mt-6 grid gap-5 xl:grid-cols-2">
        {items.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            {...presentation}
          />
        ))}
      </section>
    </main>
  );
}
