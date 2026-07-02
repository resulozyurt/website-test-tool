"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Overview" },
  { href: "/health", label: "Health" },
  { href: "/geo", label: "Geo sweep" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              "rounded-md px-3 py-1.5 text-sm transition-colors " +
              (active
                ? "bg-brand-weak text-ink"
                : "text-muted hover:text-ink")
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
