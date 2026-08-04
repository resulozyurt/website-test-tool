/**
 * Thumbnail of a full-page screenshot, streamed from R2 through the
 * dashboard's own /api/screenshot route (behind Basic Auth). Clicking opens
 * the full-resolution image in a new tab.
 *
 * Renders nothing unless the stored value is an R2 object key (namespaces
 * `sweeps/` or `health/`); legacy local-path values from before Phase 3 are
 * skipped silently.
 */

export function Screenshot({
  screenshotKey,
  alt,
}: {
  screenshotKey: string | null;
  alt: string;
}) {
  if (!screenshotKey || !/^(sweeps|health)\//.test(screenshotKey)) {
    return null;
  }
  const src = `/api/screenshot?key=${encodeURIComponent(screenshotKey)}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mt-3 block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-faint">
        Screenshot
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="max-h-64 w-auto rounded-lg border border-line object-top"
      />
    </a>
  );
}
