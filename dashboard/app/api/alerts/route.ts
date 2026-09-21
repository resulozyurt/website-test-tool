import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getAlertSettings,
  recordAlertTest,
  saveAlertSettings,
  type MinSeverity,
} from "@/lib/alertSettings";
import { sendTestEmail } from "@/lib/alertMailer";

/**
 * Alert settings API. Same guards as the proxy route: Basic Auth from
 * middleware, an encryption key (the app password is never stored in the
 * clear), a same-origin check on writes, and no credential ever included in a
 * response.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function keyConfigured(): boolean {
  const raw = process.env.SETTINGS_SECRET_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

function parseRecipients(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0 && value.includes("@"));
}

export async function GET() {
  return NextResponse.json({ settings: await getAlertSettings() });
}

export async function POST(req: NextRequest) {
  if (!keyConfigured()) {
    return NextResponse.json(
      { error: "SETTINGS_SECRET_KEY is not configured." },
      { status: 503 },
    );
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

  try {
    if (body.action === "save") {
      const recipients = parseRecipients(body.recipients);
      const fromAddress = String(body.fromAddress ?? "").trim();
      if (!fromAddress.includes("@")) {
        return NextResponse.json({ error: "A sender address is required." }, { status: 400 });
      }
      if (recipients.length === 0) {
        return NextResponse.json(
          { error: "At least one recipient is required." },
          { status: 400 },
        );
      }
      const port = Number(body.smtpPort ?? 465);
      const renotify = Number(body.renotifyHours ?? 24);
      if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(renotify) || renotify <= 0) {
        return NextResponse.json({ error: "Port and window must be positive whole numbers." }, { status: 400 });
      }
      const minSeverity: MinSeverity = body.minSeverity === "critical" ? "critical" : "major";
      const password =
        typeof body.password === "string" && body.password.length > 0
          ? body.password
          : undefined;

      await saveAlertSettings({
        enabled: Boolean(body.enabled),
        fromAddress,
        recipients,
        minSeverity,
        renotifyHours: renotify,
        smtpHost: String(body.smtpHost ?? "smtp.gmail.com").trim(),
        smtpPort: port,
        password,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "test") {
      const result = await sendTestEmail();
      await recordAlertTest(result.ok, result.error);
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The action failed." },
      { status: 500 },
    );
  }
}
