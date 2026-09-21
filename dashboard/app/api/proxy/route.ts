import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildProxy, getProvider } from "@/lib/proxy-providers.generated";
import type { CountryCode } from "@/lib/proxy-providers.generated";
import {
  activateProxySetting,
  deleteProxySetting,
  getProxyCredentials,
  listProxySettings,
  recordProxyTest,
  saveProxySetting,
} from "@/lib/proxySettings";
import { verifyProxy } from "@/lib/proxyVerify";

/**
 * Proxy settings API.
 *
 * The rest of the dashboard is read-only; this is the one route that writes,
 * so it is deliberately defensive. Basic Auth in middleware.ts already gates
 * every request. On top of that: the encryption key must be configured (no
 * plaintext credentials, ever), cross-origin posts are refused (the browser
 * sends Basic Auth automatically, so a foreign page could otherwise drive
 * this), and credentials are only ever written -- no response includes them.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COUNTRIES: CountryCode[] = ["US", "AE", "TR"];

function keyConfigured(): boolean {
  const raw = process.env.SETTINGS_SECRET_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    return true; // non-browser client; Basic Auth is the gate there
  }
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

function isCountry(value: unknown): value is CountryCode {
  return typeof value === "string" && COUNTRIES.includes(value as CountryCode);
}

function credentialsOf(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim() !== "") {
        out[key] = value.trim();
      }
    }
  }
  return out;
}

export async function GET() {
  if (!keyConfigured()) {
    return NextResponse.json({ error: "SETTINGS_SECRET_KEY is not configured." }, { status: 503 });
  }
  return NextResponse.json({ settings: await listProxySettings() });
}

export async function POST(req: NextRequest) {
  if (!keyConfigured()) {
    return NextResponse.json({ error: "SETTINGS_SECRET_KEY is not configured." }, { status: 503 });
  }
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const action = body.action;

  try {
    if (action === "save") {
      if (!isCountry(body.country)) {
        return NextResponse.json({ error: "Unknown country." }, { status: 400 });
      }
      const provider = getProvider(String(body.providerId ?? ""));
      if (!provider) {
        return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
      }
      const credentials = credentialsOf(body.credentials);
      const missing = provider.fields
        .filter((f) => !credentials[f.key])
        .map((f) => f.label);
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Missing field: ${missing.join(", ")}` },
          { status: 400 },
        );
      }
      const id = await saveProxySetting({
        id: typeof body.id === "number" ? body.id : undefined,
        country: body.country,
        providerId: provider.id,
        label: typeof body.label === "string" ? body.label : null,
        credentials,
      });
      return NextResponse.json({ id });
    }

    if (action === "test") {
      // Either a saved row (decrypted here, never sent out) or a form the
      // operator has not saved yet, so a provider can be tried before it is
      // stored at all.
      let country: CountryCode;
      let providerId: string;
      let credentials: Record<string, string>;
      const id = typeof body.id === "number" ? body.id : undefined;

      if (id) {
        const saved = await getProxyCredentials(id);
        if (!saved) {
          return NextResponse.json({ error: "Setting not found." }, { status: 404 });
        }
        ({ country, providerId, credentials } = saved);
      } else {
        if (!isCountry(body.country)) {
          return NextResponse.json({ error: "Unknown country." }, { status: 400 });
        }
        country = body.country;
        providerId = String(body.providerId ?? "");
        credentials = credentialsOf(body.credentials);
      }

      const provider = getProvider(providerId);
      if (!provider) {
        return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
      }

      const built = buildProxy(provider, credentials, country);
      const result = await verifyProxy(country, built);
      if (id) {
        await recordProxyTest(id, result.ok, result);
      }
      return NextResponse.json({ result });
    }

    if (action === "activate") {
      if (typeof body.id !== "number") {
        return NextResponse.json({ error: "A setting id is required." }, { status: 400 });
      }
      await activateProxySetting(body.id);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      if (typeof body.id !== "number") {
        return NextResponse.json({ error: "A setting id is required." }, { status: 400 });
      }
      await deleteProxySetting(body.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    // Never echo the exception verbatim to the browser beyond its message:
    // messages here are ours, but stack traces could carry connection strings.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The action failed." },
      { status: 500 },
    );
  }
}
