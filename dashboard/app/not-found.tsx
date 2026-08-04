import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-xl border border-line bg-card p-8 text-center">
      <p className="text-sm text-muted">That page doesn&rsquo;t exist.</p>
      <p className="mt-3">
        <Link
          href="/"
          className="font-mono text-xs text-brand hover:underline"
        >
          &larr; back to overview
        </Link>
      </p>
    </div>
  );
}