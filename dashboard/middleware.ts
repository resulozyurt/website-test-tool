import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const REALM = "FieldPie Monitor Dashboard";

/**
 * Constant-time string comparison to avoid leaking credential length/content
 * through response timing. Runs the full loop regardless of where a mismatch
 * occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

export function middleware(req: NextRequest): NextResponse {
  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  // Fail closed: with no credentials configured, expose nothing.
  if (!expectedUser || !expectedPassword) {
    return new NextResponse("Dashboard auth is not configured.", {
      status: 503,
    });
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded = "";
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return unauthorized();
  }

  const givenUser = decoded.slice(0, separator);
  const givenPassword = decoded.slice(separator + 1);

  const ok =
    timingSafeEqual(givenUser, expectedUser) &&
    timingSafeEqual(givenPassword, expectedPassword);

  return ok ? NextResponse.next() : unauthorized();
}

export const config = {
  // Guard every route except Next internals and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
