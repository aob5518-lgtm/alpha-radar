import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages";

export function DemoFilters({
  fields,
  messages,
  resetHref,
}: {
  fields: {
    name: string;
    label: string;
    value?: string;
    options: [string, string][];
  }[];
  messages: Messages;
  resetHref: string;
}) {
  return (
    <form className="panel mt-5 flex flex-wrap items-end gap-4 p-4">
      {fields.map((field) => (
        <label
          key={field.name}
          className="min-w-40 flex-1 text-xs text-[var(--muted)]"
        >
          {field.label}
          <select
            className="field-select mt-2"
            name={field.name}
            defaultValue={field.value ?? ""}
          >
            <option value="">{messages.common.all}</option>
            {field.options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button className="rounded-lg bg-emerald-400 px-4 py-2 text-sm text-zinc-950">
        {messages.strategy.apply}
      </button>
      <Link className="px-2 py-2 text-sm text-emerald-300" href={resetHref}>
        {messages.strategy.reset}
      </Link>
    </form>
  );
}
export function DemoSelectionNotice({
  empty,
  messages,
  resetHref,
}: {
  empty: boolean;
  messages: Messages;
  resetHref: string;
}) {
  return empty ? (
    <div className="panel mt-6 p-8">
      <h2>{messages.strategy.empty}</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {messages.strategy.notFound}
      </p>
      <Link className="mt-4 block text-emerald-300" href={resetHref}>
        {messages.strategy.reset}
      </Link>
    </div>
  ) : null;
}
