import { themeStages } from "@alpha-radar/types/strategy";
import {
  ProductTabs,
  StrategyDisclosure,
  ThemeCard,
  enumLabel,
} from "@/components/strategy/strategy-ui";
import { getTranslations } from "@/lib/i18n/server";
import { demoThemes } from "@/lib/strategy/demo-data";
import { filterThemes } from "@/lib/strategy/derive";
import {
  DemoFilters,
  DemoSelectionNotice,
} from "@/components/strategy/filters";

export default async function ThemesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const presentation = await getTranslations();
  const { messages } = presentation;
  const query = await searchParams;
  const stage = typeof query.stage === "string" ? query.stage : undefined;
  const selected = typeof query.theme === "string" ? query.theme : undefined;
  const items = filterThemes(demoThemes, stage).filter(
    (item) => !selected || item.id === selected || item.slug === selected,
  );
  return (
    <main className="page-shell">
      <h1 className="text-4xl font-semibold">{messages.strategy.themes}</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {messages.strategy.themeDescription}
      </p>
      <ProductTabs area="discover" messages={messages} />
      <StrategyDisclosure messages={messages} />
      <DemoFilters
        messages={messages}
        fields={[
          {
            name: "stage",
            label: messages.strategy.stage,
            value: stage,
            options: themeStages.map((value) => [
              value,
              enumLabel(value, messages),
            ]),
          },
        ]}
        resetHref="/discover/themes"
      />
      <DemoSelectionNotice
        empty={items.length === 0}
        messages={messages}
        resetHref="/discover/themes"
      />
      <section className="mt-6 grid gap-5 xl:grid-cols-2">
        {items.map((theme) => (
          <ThemeCard key={theme.id} theme={theme} {...presentation} />
        ))}
      </section>
    </main>
  );
}
