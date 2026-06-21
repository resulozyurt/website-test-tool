import { normalizeStatus, statusLabel } from "@/lib/format";

export function StatusBadge({
  status,
}: {
  status: string | null | undefined;
}) {
  const key = normalizeStatus(status);
  return (
    <span className={`badge s-${key}`}>
      <span className="dot" aria-hidden="true" />
      {statusLabel(key)}
    </span>
  );
}
