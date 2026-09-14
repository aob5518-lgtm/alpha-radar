import { getTranslations } from "@/lib/i18n/server";

export default async function AssetsLoading() {
  const { messages } = await getTranslations();

  return (
    <main className="mx-auto min-h-[calc(100vh-73px)] max-w-7xl animate-pulse px-5 py-10 sm:px-8">
      <div className="h-5 w-28 rounded bg-white/10" />
      <div className="mt-5 h-12 w-72 rounded bg-white/10" />
      <div className="mt-10 h-18 rounded-2xl bg-white/10" />
      <div className="mt-6 h-96 rounded-2xl bg-white/10" />
      <span className="sr-only">{messages.assets.loading}</span>
    </main>
  );
}
