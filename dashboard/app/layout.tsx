import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FieldPie Monitor",
  description: "Read-only console for the fieldpie.com geo/locale monitoring system.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="appbar">
          <div className="container appbar-inner">
            <Link href="/" className="wordmark">
              fieldpie<span className="dim">/monitor</span>
            </Link>
            <span className="appbar-meta">production · read-only</span>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
      </body>
    </html>
  );
}
