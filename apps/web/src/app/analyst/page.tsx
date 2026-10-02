import { AnalystWorkspace } from "@/components/analyst-workspace";
import { isAnalystConfigured } from "@/lib/ai/runtime";
import { getAsset } from "@/lib/api/assets";
import { getTranslations } from "@/lib/i18n/server";
import { parseAnalystHandoff } from "@/lib/market/analyst-context";

export const dynamic = "force-dynamic";

export default async function AnalystPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const handoff = parseAnalystHandoff(await searchParams);
  const { locale, messages } = await getTranslations();
  const asset = handoff
    ? await getAsset(handoff.asset).catch(() => null)
    : null;
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-4 sm:px-7">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{messages.nav.analyst}</h1>
        {asset && (
          <span className="data-pill">
            {asset.symbol} · {handoff?.interval}
          </span>
        )}
      </div>
      <div className="border bg-[var(--panel)]">
        <AnalystWorkspace
          assetId={asset?.id ?? null}
          symbol={asset?.symbol ?? null}
          timeframe={handoff?.interval ?? "1h"}
          configured={isAnalystConfigured()}
          locale={locale}
        />
      </div>
    </main>
  );
}
