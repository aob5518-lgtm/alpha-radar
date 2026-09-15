import { FlaskConical } from "lucide-react";

export function DemoBadge({ label }: { label: string }) {
  return (
    <span className="demo-badge">
      <FlaskConical className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}
