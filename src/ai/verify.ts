/**
 * AI visual verification (Phase 4, Step 4b).
 *
 * Sends a page screenshot plus the expected experience to Claude and asks for a
 * verdict (match / mismatch / uncertain) with short findings. ADVISORY ONLY:
 * the deterministic checks remain authoritative; this never changes a run's
 * pass/fail status. Primary model is Haiku 4.5; on failure it falls back to
 * Sonnet 4.6. Returns null when no API key is configured (AI simply skipped).
 *
 * Uses the native fetch + Anthropic Messages API (no SDK dependency). Image
 * tokens are included in usage.input_tokens, so cost is computed from usage.
 */

import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import type { CountryCode, ExpectationSet, LanguageCode } from "../types.js";

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

/** List prices in USD per single token (input includes image tokens). */
const PRICING: Record<string, { input: number; output: number }> = {
  [HAIKU]: { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  [SONNET]: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

const SYSTEM_PROMPT =
  "You are a meticulous QA reviewer for a website. You are given a screenshot " +
  "of one page (top portion) and the expected experience for a specific " +
  "country and language. Decide whether the screenshot matches the expected " +
  "experience. Be strict about pricing: if prices are expected to be hidden " +
  "but you see numeric prices, that is a mismatch (and vice versa). Ignore " +
  "cookie-consent dialogs and unrelated popups. Respond with ONLY a JSON " +
  'object, no preamble, of the form: {"verdict":"match"|"mismatch"|' +
  '"uncertain","confidence":0.0-1.0,"findings":["short finding", ...]}';

export type AiVerdictValue = "match" | "mismatch" | "uncertain";

export interface AiResult {
  model: string;
  verdict: AiVerdictValue;
  confidence: number | null;
  findings: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface VerifyInput {
  screenshotPath: string;
  country: CountryCode;
  language: LanguageCode;
  pageKey: string;
  expectation: ExpectationSet;
}

/** Builds a plain-language description of what the page should show. */
function describeExpectation(input: VerifyInput): string {
  const e = input.expectation;
  const lines: string[] = [
    `This page is for country=${input.country}, language=${input.language}, page=${input.pageKey}.`,
  ];
  if (e.ai?.expectedExperience) {
    lines.push(e.ai.expectedExperience);
  }
  if (e.language?.htmlLang) {
    lines.push(`The page language should be "${e.language.htmlLang}".`);
  }
  if (e.cta?.primary) {
    lines.push(`The main call-to-action should be: "${e.cta.primary}".`);
  }
  if (e.cta?.mustNotContain?.length) {
    lines.push(`These calls-to-action should NOT appear: ${e.cta.mustNotContain.join(", ")}.`);
  }
  if (e.price?.visible === true) {
    lines.push(
      `Self-serve prices should be VISIBLE${e.price.currency ? ` in "${e.price.currency}"` : ""} with numeric amounts.`,
    );
  }
  if (e.price?.visible === false) {
    lines.push(
      'Self-serve prices should be HIDDEN (e.g. "Request Pricing" / "Book a Meeting"); there should be no numeric prices.',
    );
  }
  if (e.heading?.contains) {
    lines.push(`The main heading should contain: "${e.heading.contains}".`);
  }
  if (e.phone?.equals) {
    lines.push(`The phone number should be: ${e.phone.equals}.`);
  }
  return lines.join("\n");
}

function parseVerdict(text: string): {
  verdict: AiVerdictValue;
  confidence: number | null;
  findings: unknown;
} {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned) as {
    verdict?: string;
    confidence?: number;
    findings?: unknown;
  };
  const raw = (parsed.verdict ?? "").toLowerCase();
  const verdict: AiVerdictValue =
    raw === "match" || raw === "mismatch" ? raw : "uncertain";
  const confidence =
    typeof parsed.confidence === "number" ? parsed.confidence : null;
  return { verdict, confidence, findings: parsed.findings ?? null };
}

function costOf(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const p = PRICING[model];
  if (!p || inputTokens === null || outputTokens === null) {
    return null;
  }
  return Number((inputTokens * p.input + outputTokens * p.output).toFixed(5));
}

/** One model call. Throws on transport / API / parse error. */
async function callModel(
  model: string,
  base64: string,
  userText: string,
): Promise<AiResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
            { type: "text", text: userText },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`api ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");

  const { verdict, confidence, findings } = parseVerdict(text);
  const inputTokens = data.usage?.input_tokens ?? null;
  const outputTokens = data.usage?.output_tokens ?? null;

  return {
    model,
    verdict,
    confidence,
    findings,
    inputTokens,
    outputTokens,
    costUsd: costOf(model, inputTokens, outputTokens),
    error: null,
  };
}

/**
 * Verifies one page screenshot against its expectation. Returns null when no
 * API key is set. Never throws: a failed call (both models) returns an
 * "uncertain" result carrying the error message.
 */
export async function verifyExperience(input: VerifyInput): Promise<AiResult | null> {
  if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.trim() === "") {
    return null;
  }

  let base64: string;
  try {
    base64 = (await readFile(input.screenshotPath)).toString("base64");
  } catch (err) {
    return {
      model: HAIKU,
      verdict: "uncertain",
      confidence: null,
      findings: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      error: `screenshot unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const userText = describeExpectation(input);

  try {
    return await callModel(HAIKU, base64, userText);
  } catch (haikuErr) {
    try {
      return await callModel(SONNET, base64, userText);
    } catch (sonnetErr) {
      const detail = sonnetErr instanceof Error ? sonnetErr.message : String(sonnetErr);
      const first = haikuErr instanceof Error ? haikuErr.message : String(haikuErr);
      return {
        model: SONNET,
        verdict: "uncertain",
        confidence: null,
        findings: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        error: `haiku: ${first}; sonnet: ${detail}`,
      };
    }
  }
}