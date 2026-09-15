import { cycleRegimes } from "@alpha-radar/types/strategy";
import {
  Fields,
  ProductTabs,
  StrategicBlocks,
  StrategyDisclosure,
  enumLabel,
  strategyLabel,
} from "@/components/strategy/strategy-ui";
import { DemoBadge } from "@/components/demo-badge";
import { getTranslations } from "@/lib/i18n/server";
import { localize } from "@/lib/intelligence/demo-data";
import { demoBullPhases, demoCycle } from "@/lib/strategy/demo-data";

export default async function CyclePage() {
  const presentation = await getTranslations();
  const { locale, messages } = presentation;
  return (
    <main className="page-shell">
      <h1 className="text-4xl font-semibold">{messages.strategy.readiness}</h1>
      <ProductTabs area="strategy" messages={messages} />
      <StrategyDisclosure messages={messages} />
      <p className="mt-5 text-sm leading-6 text-amber-100">
        {messages.strategy.cycleWarning}
      </p>
      <section className="panel mt-6 p-5">
        <DemoBadge label={messages.common.demoData} />
        <Fields
          values={[
            [messages.strategy.regime, enumLabel(demoCycle.regime, messages)],
            [
              messages.strategy.readiness,
              enumLabel(demoCycle.readiness, messages),
            ],
            [
              messages.strategy.confidenceBand,
              enumLabel(demoCycle.confidenceBand, messages),
            ],
            [
              messages.strategy.scenarioWindow,
              localize(demoCycle.scenarioWindow, locale),
            ],
          ]}
        />
        <Fields
          values={Object.entries(demoCycle.dimensions).map(([key, value]) => [
            strategyLabel(key, messages),
            enumLabel(value, messages),
          ])}
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <section>
            <h2 className="section-label">{messages.strategy.evidence}</h2>
            {demoCycle.evidence.map((value) => (
              <p key={value.en} className="mt-3 text-sm">
                {localize(value, locale)}
              </p>
            ))}
          </section>
          <section>
            <h2 className="section-label text-amber-300">
              {messages.strategy.counterEvidence}
            </h2>
            {demoCycle.counterEvidence.map((value) => (
              <p key={value.en} className="mt-3 text-sm">
                {localize(value, locale)}
              </p>
            ))}
          </section>
        </div>
        <StrategicBlocks object={demoCycle} {...presentation} />
        <div className="mt-5 flex flex-wrap gap-2">
          {cycleRegimes.map((regime) => (
            <span key={regime} className="data-pill">
              {enumLabel(regime, messages)}
            </span>
          ))}
        </div>
      </section>
      <h2 className="mt-8 text-2xl font-semibold">
        {messages.strategy.bullPlaybook}
      </h2>
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {demoBullPhases.map((phase) => (
          <article key={phase.id} className="panel p-5">
            <DemoBadge label={messages.common.demoData} />
            <h3 className="mt-3 text-lg font-semibold">
              {localize(phase.name, locale)}
            </h3>
            <Fields
              values={[
                [messages.strategy.signals, localize(phase.signals, locale)],
                [
                  messages.strategy.typicalBehavior,
                  localize(phase.typicalBehavior, locale),
                ],
                [messages.strategy.research, localize(phase.research, locale)],
                [messages.strategy.risks, localize(phase.risks, locale)],
                [
                  messages.strategy.exitConsiderations,
                  localize(phase.exitConsiderations, locale),
                ],
              ]}
            />
            <StrategicBlocks object={phase} {...presentation} />
          </article>
        ))}
      </div>
    </main>
  );
}
