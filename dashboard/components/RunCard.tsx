import { formatCost, formatPercent, normalizeStatus } from "@/lib/format";
import type { AiVerdictView, CheckView, RunView } from "@/lib/queries";
import { CheckTable } from "./CheckTable";
import { StatusBadge } from "./StatusBadge";

function MetaItem({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="meta-item">
      <span className="k">{k}</span>
      <span className={`v${tone ? ` ${tone}` : ""}`}>{v}</span>
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

function AiBlock({ ai }: { ai: AiVerdictView | undefined }) {
  if (!ai) return null;
  const verdict = ai.verdict.toLowerCase();
  return (
    <div className="ai">
      <span className="tag">AI · advisory</span>
      <span className={`verdict ${verdict}`}>{ai.verdict}</span>
      <span className="field">conf {formatPercent(ai.confidence)}</span>
      <span className="field">{ai.model}</span>
      <span className="field">cost {formatCost(ai.costUsd)}</span>
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
    <div className="card run">
      <div className={`run-spine spine-${spine}`} aria-hidden="true" />
      <div className="run-body">
        <div className="run-head">
          <div className="run-title">
            {run.country}
            <span className="sep">/</span>
            {run.pageKey}
            <span className="sep">·</span>
            {run.language}
          </div>
          <StatusBadge status={run.status} />
        </div>

        <div className="meta">
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
      </div>
    </div>
  );
}
