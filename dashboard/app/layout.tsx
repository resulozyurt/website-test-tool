import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "FieldPie Monitor",
  description:
    "Read-only console for the fieldpie.com geo/locale monitoring system.",
  robots: { index: false, follow: false },
};

// Runs before paint to apply the saved theme and avoid a light/dark flash.
// Default is light: only switch to dark when the user explicitly chose it.
const THEME_SCRIPT = `(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1160px] items-center justify-between px-6">
            <div className="flex items-center gap-8">
              <a href="/" className="font-mono text-[15px] tracking-tight">
                fieldpie<span className="text-faint">/monitor</span>
              </a>
              <Nav />
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden font-mono text-xs text-muted sm:inline">
                production · read-only
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1160px] px-6 pb-24 pt-8">{children}</main>
      </body>
    </html>
  );
}
