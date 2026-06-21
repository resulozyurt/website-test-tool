import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card empty">
      <p>That sweep or page does not exist.</p>
      <p>
        <Link href="/" className="mono" style={{ color: "var(--accent)" }}>
          ← back to sweeps
        </Link>
      </p>
    </div>
  );
}
