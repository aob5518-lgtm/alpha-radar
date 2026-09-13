export default function AssetsLoading() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl animate-pulse px-5 py-10 sm:px-8">
      <div className="h-5 w-28 rounded bg-white/10" />
      <div className="mt-5 h-12 w-72 rounded bg-white/10" />
      <div className="mt-10 h-18 rounded-2xl bg-white/10" />
      <div className="mt-6 h-96 rounded-2xl bg-white/10" />
      <span className="sr-only">Loading assets</span>
    </main>
  );
}
