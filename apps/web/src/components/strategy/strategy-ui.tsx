import type {
  AirdropOpportunity,
  Catalyst,
  DemoObject,
  EarlyProject,
  Opportunity,
  StrategyPlaybook,
  Theme,
} from "@alpha-radar/types/strategy";
import type { LocalizedText } from "@alpha-radar/types/radar";
import Link from "next/link";
import { DemoBadge } from "@/components/demo-badge";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { formatDateTime } from "@/lib/i18n/format";
import { horizonLabel, pricedInLabel } from "@/lib/i18n/intelligence-labels";
import { allDemoAssets, localize } from "@/lib/intelligence/demo-data";
import {
  demoCatalysts,
  demoOpportunities,
  demoOutcomes,
  demoPlaybooks,
  demoProjects,
  demoThemes,
} from "@/lib/strategy/demo-data";
import {
  catalystHref,
  opportunityHref,
  playbookHref,
  projectHref,
  strategyForAsset,
  strategyForEvent,
  themeHref,
} from "@/lib/strategy/derive";

export interface StrategyPresentation {
  locale: Locale;
  messages: Messages;
}
export function strategyLabel(key: string, messages: Messages): string {
  const label = Object.entries(messages.strategy).find(
    ([name]) => name === key,
  )?.[1];
  return typeof label === "string" ? label : key;
}
export function enumLabel(key: string, messages: Messages): string {
  return (
    Object.entries(messages.strategy.enums).find(
      ([name]) => name === key,
    )?.[1] ?? key
  );
}
export function StrategyDisclosure({
  messages,
}: Pick<StrategyPresentation, "messages">) {
  return (
    <div className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-xs leading-6 text-amber-100">
      <DemoBadge label={messages.common.demoData} />
      <p className="mt-2">{messages.strategy.disclaimer}</p>
      <p>{messages.strategy.discipline}</p>
    </div>
  );
}
export function ProductTabs({
  area,
  messages,
}: {
  area: "discover" | "strategy";
  messages: Messages;
}) {
  const links =
    area === "discover"
      ? [
          ["/discover/themes", "themes"],
          ["/discover#projects", "projects"],
          ["/discover/opportunities", "opportunities"],
        ]
      : [
          ["/strategy/cycle", "cycle"],
          ["/strategy#playbooks", "playbooks"],
          ["/strategy#plans", "plans"],
        ];
  return (
    <nav
      aria-label={
        area === "discover" ? messages.nav.discover : messages.nav.strategy
      }
      className="mt-5 flex flex-wrap gap-2"
    >
      {links.map(([href, key]) =>
        href && key ? (
          <Link
            className="data-pill hover:border-emerald-400"
            key={key}
            href={href}
          >
            {strategyLabel(key, messages)}
          </Link>
        ) : null,
      )}
    </nav>
  );
}
export function StrategicBlocks({
  object,
  locale,
  messages,
}: StrategyPresentation & { object: DemoObject }) {
  return (
    <details className="mt-4 rounded-lg border p-3">
      <summary className="cursor-pointer text-xs font-semibold text-emerald-300">
        {messages.strategy.details}
        <span className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--muted)]">
          {object.blocks.map((block) => (
            <span key={block.kind}>{strategyLabel(block.kind, messages)}</span>
          ))}
        </span>
      </summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {object.blocks.map((block) => (
          <section
            key={block.kind}
            className="rounded-lg border bg-black/15 p-3"
          >
            <h4
              className={
                block.kind === "invalidation"
                  ? "section-label text-rose-300"
                  : block.kind === "counterpoint"
                    ? "section-label text-amber-300"
                    : "section-label"
              }
            >
              {strategyLabel(block.kind, messages)}
            </h4>
            <p className="mt-2 text-sm leading-6">
              {localize(block.content, locale)}
            </p>
          </section>
        ))}
      </div>
    </details>
  );
}
export function Fields({ values }: { values: [string, string][] }) {
  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-[var(--muted)]">{label}</dt>
          <dd className="mt-1 text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Bands({
  values,
  messages,
}: {
  values: Record<string, string>;
  messages: Messages;
}) {
  return (
    <Fields
      values={Object.entries(values).map(([key, value]) => [
        strategyLabel(key, messages),
        enumLabel(value, messages),
      ])}
    />
  );
}
function CardHeader({
  title,
  stage,
  messages,
}: {
  title: string;
  stage?: string;
  messages: Messages;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="flex gap-2">
        <DemoBadge label={messages.common.demoData} />
        {stage && (
          <span className="data-pill">{enumLabel(stage, messages)}</span>
        )}
      </div>
    </div>
  );
}
function TextField({
  label,
  value,
  locale,
}: {
  label: string;
  value: LocalizedText;
  locale: Locale;
}) {
  return (
    <section className="mt-4">
      <h4 className="section-label">{label}</h4>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {localize(value, locale)}
      </p>
    </section>
  );
}
export function ThemeCard({
  theme,
  ...presentation
}: StrategyPresentation & { theme: Theme }) {
  const { locale, messages } = presentation;
  return (
    <article id={theme.id} className="panel scroll-mt-20 p-5">
      <CardHeader
        title={localize(theme.name, locale)}
        stage={theme.stage}
        messages={messages}
      />
      <p className="mt-3 text-sm text-[var(--muted)]">
        {localize(theme.description, locale)}
      </p>
      <Bands values={theme.metrics} messages={messages} />
      <StrategicBlocks object={theme} {...presentation} />
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-emerald-300">
        <Link href={themeHref(theme.id)}>{messages.strategy.details}</Link>
        <Link href={`/discover/opportunities?theme=${theme.id}`}>
          {messages.strategy.opportunities}
        </Link>
        <Link href={`/discover?theme=${theme.id}#projects`}>
          {messages.strategy.projects}
        </Link>
      </div>
    </article>
  );
}
export function OpportunityCard({
  opportunity,
  ...presentation
}: StrategyPresentation & { opportunity: Opportunity }) {
  const { locale, messages } = presentation;
  const playbook = demoPlaybooks.find(
    (item) => item.opportunityId === opportunity.id,
  );
  const theme = demoThemes.find((item) => item.id === opportunity.themeId);
  return (
    <article className="panel scroll-mt-20 p-5">
      <CardHeader
        title={localize(opportunity.title, locale)}
        stage={opportunity.stage}
        messages={messages}
      />
      <p className="mt-3 text-sm text-[var(--muted)]">
        {localize(opportunity.summary, locale)}
      </p>
      <Fields
        values={[
          [
            messages.strategy.type,
            enumLabel(opportunity.opportunityType, messages),
          ],
          [
            messages.strategy.horizon,
            horizonLabel(opportunity.timeHorizon, messages),
          ],
        ]}
      />
      <Bands
        values={{
          rewardPotential: opportunity.rewardPotential,
          riskLevel: opportunity.riskLevel,
          capitalRequirement: opportunity.capitalRequirement,
          timeRequirement: opportunity.timeRequirement,
          crowding: opportunity.crowding,
          confidenceBand: opportunity.confidenceBand,
        }}
        messages={messages}
      />
      <TextField
        label={messages.strategy.thesis}
        value={opportunity.thesis}
        locale={locale}
      />
      <TextField
        label={messages.strategy.counterpoint}
        value={opportunity.counterThesis}
        locale={locale}
      />
      <TextField
        label={messages.strategy.invalidation}
        value={opportunity.invalidation}
        locale={locale}
      />
      <TextField
        label={messages.strategy.watchNext}
        value={opportunity.watchNext}
        locale={locale}
      />
      <AssetLinks ids={opportunity.affectedAssetIds} messages={messages} />
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-emerald-300">
        {theme && (
          <Link href={themeHref(theme.id)}>{localize(theme.name, locale)}</Link>
        )}
        {opportunity.relatedProjectIds.map((id) => (
          <Link key={id} href={projectHref(id)}>
            {localize(
              demoProjects.find((item) => item.id === id)?.name ?? {
                en: id,
                "zh-CN": id,
              },
              locale,
            )}
          </Link>
        ))}
        {opportunity.catalystIds.map((id) => (
          <Link key={id} href={catalystHref(id)}>
            {messages.strategy.catalysts}
          </Link>
        ))}
        <Link href={opportunityHref(opportunity.id)}>
          {messages.strategy.details}
        </Link>
        <Link
          href={
            playbook
              ? playbookHref(playbook.id)
              : `/strategy?opportunity=${opportunity.id}#plans`
          }
        >
          {messages.nav.strategy}
        </Link>
      </div>
      <StrategicBlocks object={opportunity} {...presentation} />
    </article>
  );
}
export function ProjectCard({
  project,
  ...presentation
}: StrategyPresentation & { project: EarlyProject }) {
  const { locale, messages } = presentation;
  return (
    <article id={project.id} className="panel scroll-mt-20 p-5">
      <CardHeader title={localize(project.name, locale)} messages={messages} />
      <p className="mt-3 text-xs text-amber-200">
        {messages.strategy.attentionLag}
      </p>
      <Bands
        values={{
          productStage: project.productStage,
          tokenStatus: project.tokenStatus,
          ...project.dimensions,
        }}
        messages={messages}
      />
      <StrategicBlocks object={project} {...presentation} />
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-emerald-300">
        <Link href={themeHref(project.themeId)}>{messages.strategy.theme}</Link>
        <Link href={projectHref(project.id)}>{messages.strategy.details}</Link>
        {demoOpportunities
          .filter((item) => item.relatedProjectIds.includes(project.id))
          .map((item) => (
            <Link key={item.id} href={opportunityHref(item.id)}>
              {localize(item.title, locale)}
            </Link>
          ))}
      </div>
    </article>
  );
}
export function AirdropCard({
  airdrop,
  ...presentation
}: StrategyPresentation & { airdrop: AirdropOpportunity }) {
  const { locale, messages } = presentation;
  const project = demoProjects.find((item) => item.id === airdrop.projectId);
  return (
    <article className="panel p-5">
      <CardHeader
        title={project ? localize(project.name, locale) : airdrop.projectId}
        messages={messages}
      />
      <Bands
        values={{
          tokenStatus: airdrop.tokenStatus,
          officialAirdropStatus: airdrop.officialAirdropStatus,
          pointsProgram: airdrop.pointsProgram,
          capitalRequirement: airdrop.capitalRequirement,
          estimatedGasCostBand: airdrop.estimatedGasCostBand,
          timeRequirement: airdrop.timeRequirement,
          sybilRisk: airdrop.sybilRisk,
          dilutionRisk: airdrop.dilutionRisk,
          lockupRisk: airdrop.lockupRisk,
          opportunityCost: airdrop.opportunityCost,
          rewardPotential: airdrop.rewardPotential,
          confidenceBand: airdrop.confidenceBand,
          action: airdrop.action,
        }}
        messages={messages}
      />
      <TextField
        label={messages.strategy.opportunityBasis}
        value={airdrop.opportunityBasis}
        locale={locale}
      />
      <StrategicBlocks object={airdrop} {...presentation} />
      <div className="mt-4 flex gap-4 text-sm text-emerald-300">
        <Link href={projectHref(airdrop.projectId)}>
          {messages.strategy.projects}
        </Link>
        <Link href={opportunityHref(airdrop.opportunityId)}>
          {messages.strategy.opportunities}
        </Link>
      </div>
    </article>
  );
}
export function CatalystCard({
  catalyst,
  ...presentation
}: StrategyPresentation & { catalyst: Catalyst }) {
  const { locale, messages } = presentation;
  return (
    <article id={catalyst.id} className="panel scroll-mt-20 p-5">
      <CardHeader
        title={localize(catalyst.title, locale)}
        stage={catalyst.status}
        messages={messages}
      />
      <Fields
        values={[
          [
            messages.strategy.scheduledAt,
            catalyst.scheduledAt
              ? formatDateTime(catalyst.scheduledAt, locale, {
                  timeZone: "UTC",
                })
              : messages.strategy.dateUnknown,
          ],
          [
            messages.strategy.pricedIn,
            pricedInLabel(catalyst.pricedIn, messages),
          ],
        ]}
      />
      <Bands
        values={{
          type: catalyst.catalystType,
          dateCertainty: catalyst.dateCertainty,
          impact: catalyst.impact,
          probabilityBand: catalyst.probabilityBand,
        }}
        messages={messages}
      />
      <TextField
        label={messages.strategy.preparationWindow}
        value={catalyst.preparationWindow}
        locale={locale}
      />
      <AssetLinks ids={catalyst.affectedAssetIds} messages={messages} />
      <StrategicBlocks object={catalyst} {...presentation} />
    </article>
  );
}
export function PlaybookCard({
  playbook,
  ...presentation
}: StrategyPresentation & { playbook: StrategyPlaybook }) {
  const { locale, messages } = presentation;
  const outcome = demoOutcomes.find((item) => item.strategyId === playbook.id);
  return (
    <article id={playbook.id} className="panel scroll-mt-20 p-5">
      <CardHeader
        title={localize(playbook.title, locale)}
        messages={messages}
      />
      <Link
        className="mt-3 block text-sm text-emerald-300"
        href={opportunityHref(playbook.opportunityId)}
      >
        {messages.strategy.opportunities}
      </Link>
      <TextField
        label={messages.strategy.thesis}
        value={playbook.thesis}
        locale={locale}
      />
      <Fields
        values={[
          [
            messages.strategy.horizon,
            horizonLabel(playbook.timeHorizon, messages),
          ],
          [
            messages.strategy.capitalRequirement,
            enumLabel(playbook.capitalRequirement, messages),
          ],
          [messages.strategy.action, enumLabel(playbook.action, messages)],
        ]}
      />
      <section className="mt-4">
        <h4 className="section-label">{messages.strategy.evidence}</h4>
        {playbook.evidence.map((value) => (
          <p key={value.en} className="mt-2 text-sm">
            {localize(value, locale)}
          </p>
        ))}
      </section>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {Object.entries(playbook.scenarios).map(([kind, value]) => (
          <section key={kind} className="rounded-xl border p-4">
            <h4 className="section-label">
              {messages.strategy.scenario} · {strategyLabel(kind, messages)}
            </h4>
            <p className="mt-2 text-sm leading-6">{localize(value, locale)}</p>
          </section>
        ))}
      </div>
      <TextField
        label={messages.strategy.entryConditions}
        value={playbook.entryConditions}
        locale={locale}
      />
      <TextField
        label={messages.strategy.invalidation}
        value={playbook.invalidation}
        locale={locale}
      />
      <TextField
        label={messages.strategy.risks}
        value={playbook.risks}
        locale={locale}
      />
      <TextField
        label={messages.strategy.watchNext}
        value={playbook.watchNext}
        locale={locale}
      />
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-emerald-300">
        {playbook.catalystIds.map((id) => (
          <Link key={id} href={catalystHref(id)}>
            {localize(
              demoCatalysts.find((item) => item.id === id)?.title ?? {
                en: id,
                "zh-CN": id,
              },
              locale,
            )}
          </Link>
        ))}
      </div>
      <section className="mt-6 border-t pt-4">
        <h4 className="font-semibold">{messages.strategy.exit}</h4>
        <div className="mt-3 flex flex-wrap gap-2">
          {playbook.exit.triggers.map((trigger) => (
            <span className="data-pill" key={trigger}>
              {enumLabel(trigger, messages)}
            </span>
          ))}
        </div>
        {Object.entries(playbook.exit)
          .filter(([key]) => key !== "triggers")
          .map(([key, value]) =>
            !Array.isArray(value) ? (
              <TextField
                key={key}
                label={strategyLabel(key, messages)}
                value={value}
                locale={locale}
              />
            ) : null,
          )}
      </section>
      <StrategicBlocks object={playbook} {...presentation} />
      {outcome && (
        <section className="mt-6 border-t pt-4">
          <h4 className="font-semibold">{messages.strategy.outcome}</h4>
          <Fields
            values={[
              [
                messages.strategy.prediction,
                localize(outcome.prediction, locale),
              ],
              [messages.strategy.result, enumLabel(outcome.result, messages)],
              ...[
                "observationStart",
                "observationEnd",
                "returnPct",
                "maxDrawdownPct",
                "thesisCorrect",
                "modelVersion",
              ].map((key): [string, string] => [
                strategyLabel(key, messages),
                messages.strategy.unobserved,
              ]),
            ]}
          />
          <p className="mt-3 text-sm">{localize(outcome.lessons, locale)}</p>
          <StrategicBlocks object={outcome} {...presentation} />
        </section>
      )}
    </article>
  );
}
export function AssetLinks({
  ids,
  messages,
}: {
  ids: string[];
  messages: Messages;
}) {
  return (
    <div className="mt-4">
      <p className="section-label">{messages.strategy.assets}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ids.map((id) => (
          <Link
            key={id}
            href={`/assets/${id}`}
            className="data-pill hover:border-emerald-400"
          >
            {allDemoAssets.find((item) => item.assetId === id)?.symbol ?? id}
          </Link>
        ))}
      </div>
    </div>
  );
}
export function RelatedStrategy({
  assetId,
  eventId,
  ...presentation
}: StrategyPresentation & { assetId?: string; eventId?: string }) {
  const related = assetId
    ? strategyForAsset(assetId)
    : strategyForEvent(eventId ?? "");
  const { locale, messages } = presentation;
  if (
    !related.themes.length &&
    !related.opportunities.length &&
    !related.catalysts.length
  )
    return null;
  return (
    <section className="panel mt-6 p-5">
      <CardHeader title={messages.strategy.related} messages={messages} />
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-emerald-300">
        {related.themes.map((item) => (
          <Link key={item.id} href={themeHref(item.id)}>
            {messages.strategy.theme}: {localize(item.name, locale)}
          </Link>
        ))}
        {related.opportunities.map((item) => (
          <Link key={item.id} href={opportunityHref(item.id)}>
            {localize(item.title, locale)}
          </Link>
        ))}
        {related.catalysts.map((item) => (
          <Link key={item.id} href={catalystHref(item.id)}>
            {localize(item.title, locale)}
          </Link>
        ))}
      </div>
      {assetId &&
        strategyForAsset(assetId).playbooks.map((item) => (
          <div key={item.id} className="mt-4">
            <Link
              className="text-sm text-emerald-300"
              href={playbookHref(item.id)}
            >
              {messages.strategy.watchNext}: {localize(item.watchNext, locale)}
            </Link>
          </div>
        ))}
      <p className="mt-4 text-xs text-amber-100">
        {messages.strategy.disclaimer}
      </p>
    </section>
  );
}
