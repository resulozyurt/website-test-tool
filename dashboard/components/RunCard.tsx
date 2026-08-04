import { formatCost, formatPercent, normalizeStatus, type StatusKey } from "@/lib/format";
import type { AiVerdictView, CheckView, RunView } from "@/lib/queries";
import { CheckTable } from "./CheckTable";
import { Screenshot } from "./Screenshot";
import { StatusPill } from "./health/StatusPill";

/** Left spine color: a run's status at a glance, before you read anything. */
const SPINE: Record<StatusKey, string> = {
  pass: "bg-[var(--st-ok)]",
  warn: "bg-[var(--st-warn)]",
  fail: "bg-[var(--st-bad)]",
  error: "bg-[var(--st-err)]",
  running: "bg-[var(--st-info)]",
  unknown: "bg-[var(--app-faint)]",
};

function MetaItem({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-[var(--st-ok-fg)]"
      : tone === "bad"
        ? "text-[var(--st-bad-fg)]"
        : "text-ink-2";
  return (
    <div className="flex flex-col gap-px">
      <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
        {k}
      </span>
      <span className={"font-mono text-xs " + toneClass}>{v}</span>
    </div>
  );
}

/** The site-detected country is the geo check's actual value (whereami). */
function siteCountryOf(checks: CheckView[]): string | null {
  const geo = checks.find((c) => c.type === "geo");
  return geo?.actual ?? null;
}

function cacheTone(value: string | null): "good" | undefined {
  return value && value.toUpperCase().includes("HIT") ? "good" : undefined;
}

const VERDICT_TONE: Record<string, string> = {
  match: "text-[var(--st-ok-fg)]",
  mismatch: "text-[var(--st-warn-fg)]",
  uncertain: "text-muted",
};

function AiBlock({ ai }: { ai: AiVerdictView | undefined }) {
  if (!ai) return null;
  const verdict = ai.verdict.toLowerCase();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-line-strong bg-elev px-3.5 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
        AI · advisory
      </span>
      <span
        className={
          "font-mono text-xs font-semibold " +
          (VERDICT_TONE[verdict] ?? "text-muted")
        }
      >
        {ai.verdict}
      </span>
      <span className="font-mono text-xs text-ink-2">
        conf {formatPercent(ai.confidence)}
      </span>
      <span className="font-mono text-xs text-ink-2">{ai.model}</span>
      <span className="font-mono text-xs text-ink-2">
        cost {formatCost(ai.costUsd)}
      </span>
    </div>
  );
}

export function RunCard({
  run,
  checks,
  ai,
}: {
  run: RunView;
  checks: CheckView[];
  ai: AiVerdictView | undefined;
}) {
  const spine = normalizeStatus(run.status);
  const site = siteCountryOf(checks);
  const exitToSite = `${run.exitCountry ?? "?"} → ${site ?? "?"}`;
  const geoMismatch = Boolean(site && run.exitCountry && site !== run.exitCountry);

  return (
    <div className="grid grid-cols-[4px_1fr] overflow-hidden rounded-xl border border-line bg-card">
      <div className={SPINE[spine]} aria-hidden="true" />
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-mono text-[15px] font-semibold">
            {run.country}
            <span className="mx-1.5 text-faint">/</span>
            {run.pageKey}
            <span className="mx-1.5 text-faint">·</span>
            {run.language}
          </div>
          <StatusPill status={run.status} />
        </div>

        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
          <MetaItem
            k="HTTP"
            v={run.httpStatus ? String(run.httpStatus) : "—"}
            tone={run.httpStatus === 200 ? "good" : run.httpStatus ? "bad" : undefined}
          />
          <MetaItem
            k="Kinsta cache"
            v={run.kinstaCache ?? "—"}
            tone={cacheTone(run.kinstaCache)}
          />
          <MetaItem
            k="Exit → site"
            v={exitToSite}
            tone={geoMismatch ? "bad" : undefined}
          />
          <MetaItem k="Content lang" v={run.contentLanguage ?? "—"} />
          {run.error ? <MetaItem k="Error" v={run.error} tone="bad" /> : null}
        </div>

        <CheckTable checks={checks} />
        <AiBlock ai={ai} />
        <Screenshot
          screenshotKey={run.screenshotKey}
          alt={`${run.country}/${run.pageKey} screenshot`}
        />
      </div>
    </div>
  );
}