import Link from "next/link";
import { DemoSelectionNotice } from "@/components/strategy/filters";
import {
  AirdropCard,
  CatalystCard,
  OpportunityCard,
  PlaybookCard,
  ProductTabs,
  ProjectCard,
  StrategyDisclosure,
  ThemeCard,
  enumLabel,
} from "@/components/strategy/strategy-ui";
import { getTranslations } from "@/lib/i18n/server";
import { localize } from "@/lib/intelligence/demo-data";
import {
  demoAirdrops,
  demoCatalysts,
  demoCycle,
  demoOpportunities,
  demoPlaybooks,
  demoProjects,
  demoThemes,
} from "@/lib/strategy/demo-data";

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const presentation = await getTranslations();
  const { locale, messages } = presentation;
  const query = await searchParams;
  const playbookId =
    typeof query.playbook === "string" ? query.playbook : undefined;
  const catalystId =
    typeof query.catalyst === "string" ? query.catalyst : undefined;
  const opportunityId =
    typeof query.opportunity === "string" ? query.opportunity : undefined;
  const playbooks = demoPlaybooks.filter(
    (item) => !playbookId || item.id === playbookId,
  );
  const catalysts = demoCatalysts.filter(
    (item) => !catalystId || item.id === catalystId,
  );
  const plans = demoOpportunities.filter(
    (item) => !opportunityId || item.id === opportunityId,
  );
  const sections = [
    ["opportunities", messages.strategy.top],
    ["themes", messages.strategy.themeWatch],
    ["catalysts", messages.strategy.catalysts],
    ["projects", messages.strategy.earlyProjects],
    ["airdrops", messages.strategy.airdrops],
    ["exit", messages.strategy.exitWatch],
    ["cycle", messages.strategy.readiness],
    ["playbooks", messages.strategy.activePlaybooks],
    ["plans", messages.strategy.plans],
  ];
  return (
    <main className="page-shell">
      <p className="section-label">{messages.strategy.overview}</p>
      <h1 className="mt-2 text-4xl font-semibold">{messages.strategy.title}</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {messages.strategy.description}
      </p>
      <ProductTabs area="strategy" messages={messages} />
      <StrategyDisclosure messages={messages} />
      <nav
        className="mt-5 flex flex-wrap gap-2"
        aria-label={messages.strategy.overview}
      >
        {sections.map(([id, label]) => (
          <Link key={id} href={`#${id}`} className="data-pill">
            {label}
          </Link>
        ))}
      </nav>
      <Section id="opportunities" title={messages.strategy.top}>
        <div className="grid gap-4 xl:grid-cols-2">
          {demoOpportunities.slice(0, 2).map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              {...presentation}
            />
          ))}
        </div>
      </Section>
      <Section id="themes" title={messages.strategy.themeWatch}>
        <div className="grid gap-4 xl:grid-cols-2">
          {demoThemes.map((theme) => (
            <ThemeCard key={theme.id} theme={theme} {...presentation} />
          ))}
        </div>
      </Section>
      <Section id="catalysts" title={messages.strategy.catalysts}>
        <DemoSelectionNotice
          empty={!catalysts.length}
          messages={messages}
          resetHref="/strategy#catalysts"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {catalysts.map((catalyst) => (
            <CatalystCard
              key={catalyst.id}
              catalyst={catalyst}
              {...presentation}
            />
          ))}
        </div>
      </Section>
      <Section id="projects" title={messages.strategy.earlyProjects}>
        <div className="grid gap-4 xl:grid-cols-2">
          {demoProjects.map((project) => (
            <ProjectCard key={project.id} project={project} {...presentation} />
          ))}
        </div>
      </Section>
      <Section id="airdrops" title={messages.strategy.airdrops}>
        <div className="grid gap-4 xl:grid-cols-2">
          {demoAirdrops.map((airdrop) => (
            <AirdropCard key={airdrop.id} airdrop={airdrop} {...presentation} />
          ))}
        </div>
      </Section>
      <Section id="exit" title={messages.strategy.exitWatch}>
        <div className="panel p-5">
          <p className="text-sm text-amber-100">
            {messages.strategy.discipline}
          </p>
          {demoPlaybooks.map((item) => (
            <Link
              key={item.id}
              href={`?playbook=${item.id}#playbooks`}
              className="mt-4 block text-sm text-emerald-300"
            >
              {localize(item.title, locale)} · {messages.strategy.exit}
            </Link>
          ))}
          <p className="mt-3 text-xs text-[var(--muted)]">
            {messages.strategy.disclaimer}
          </p>
        </div>
      </Section>
      <Section id="cycle" title={messages.strategy.readiness}>
        <div className="panel p-5">
          <p>
            {messages.strategy.regime}: {enumLabel(demoCycle.regime, messages)}{" "}
            · {messages.strategy.readiness}:{" "}
            {enumLabel(demoCycle.readiness, messages)}
          </p>
          <p className="mt-3 text-sm text-amber-100">
            {messages.strategy.cycleWarning}
          </p>
          <Link href="/strategy/cycle" className="mt-4 block text-emerald-300">
            {messages.strategy.details}
          </Link>
        </div>
      </Section>
      <Section id="playbooks" title={messages.strategy.activePlaybooks}>
        <DemoSelectionNotice
          empty={!playbooks.length}
          messages={messages}
          resetHref="/strategy#playbooks"
        />
        <div className="space-y-5">
          {playbooks.map((playbook) => (
            <PlaybookCard
              key={playbook.id}
              playbook={playbook}
              {...presentation}
            />
          ))}
        </div>
      </Section>
      <Section id="plans" title={messages.strategy.plans}>
        <p className="mb-4 text-sm text-amber-100">
          {messages.strategy.lifecycle}
        </p>
        <DemoSelectionNotice
          empty={!plans.length}
          messages={messages}
          resetHref="/strategy#plans"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {plans.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              {...presentation}
            />
          ))}
        </div>
      </Section>
    </main>
  );
}
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-24">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}
