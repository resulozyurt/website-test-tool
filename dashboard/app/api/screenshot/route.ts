/**
 * Streams a screenshot from R2, behind the dashboard's Basic Auth (middleware
 * covers /api/*). The runner stores object keys like `sweeps/run-123.png` or
 * `health/run-45/US-en-home.png`; only those namespaces are allowed, so this
 * route can never be used to read arbitrary objects.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fetchObject, isStorageConfigured } from "@/lib/r2";

export const dynamic = "force-dynamic";

const ALLOWED_KEY = /^(sweeps|health)\/[A-Za-z0-9._/-]+\.png$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return new NextResponse("missing key", { status: 400 });
  }
  if (key.includes("..") || !ALLOWED_KEY.test(key)) {
    return new NextResponse("invalid key", { status: 400 });
  }
  if (!isStorageConfigured()) {
    return new NextResponse("storage not configured", { status: 404 });
  }

  const res = await fetchObject(key);
  if (!res || !res.body) {
    return new NextResponse("not found", { status: 404 });
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "private, max-age=3600",
    },
  });
}
