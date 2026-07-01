/**
 * On-demand AI visual review for the health crawl.
 *
 * Long pages cannot be judged from one shrunk full-page image (text becomes
 * unreadable) or one top-only crop (misses everything below the fold). So the
 * page is sliced into readable, viewport-height tiles and ALL slices are sent
 * in a single Claude call as sequential images; the model sees the whole page
 * at a legible resolution and reports layout/visual defects plus one short
 * suggestion.
 *
 * ADVISORY ONLY: never overrides deterministic checks. Skipped (returns null)
 * when no API key is set. Mirrors ai/verify.ts (native fetch, Haiku primary /
 * Sonnet fallback, cost from usage). Runs only when the crawl enables AI.
 */

import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import type { CountryCode } from "../types.js";

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

/** List prices in USD per single token (input includes image tokens). */
const PRICING: Record<string, { input: number; output: number }> = {
  [HAIKU]: { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  [SONNET]: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

const SYSTEM_PROMPT =
  "You are a meticulous web QA reviewer. You are given ordered screenshot " +
  "slices of ONE web page, top to bottom (they stitch into the full page). " +
  "Look ONLY for objective visual/layout defects: broken or missing images, " +
  "text overflowing or overlapping other elements, cut-off or clipped content, " +
  "elements spilling off the page, obviously misaligned or collapsed layout, " +
  "unstyled/raw content. Ignore cookie banners and marketing popups. Do NOT " +
  "comment on wording, copy, or subjective taste. Respond with ONLY a JSON " +
  'object, no preamble: {"verdict":"clean"|"issues"|"uncertain",' +
  '"confidence":0.0-1.0,"issues":["short concrete defect", ...],' +
  '"suggestion":"one short sentence or empty"}';

export type AiVisualVerdict = "clean" | "issues" | "uncertain";

export interface AiVisualResult {
  model: string;
  verdict: AiVisualVerdict;
  confidence: number | null;
  issues: string[];
  suggestion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  error: string | null;
}

export interface AiVisualInput {
  /** Ordered slice image paths, top to bottom. */
  slicePaths: string[];
  country: CountryCode;
  language: string;
  url: string;
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

function parseVerdict(text: string): {
  verdict: AiVisualVerdict;
  confidence: number | null;
  issues: string[];
  suggestion: string | null;
} {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned) as {
    verdict?: string;
    confidence?: number;
    issues?: unknown;
    suggestion?: unknown;
  };
  const raw = (parsed.verdict ?? "").toLowerCase();
  const verdict: AiVisualVerdict =
    raw === "clean" || raw === "issues" ? raw : "uncertain";
  const confidence =
    typeof parsed.confidence === "number" ? parsed.confidence : null;
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((i) => String(i)).slice(0, 20)
    : [];
  const suggestion =
    typeof parsed.suggestion === "string" && parsed.suggestion.trim()
      ? parsed.suggestion.trim()
      : null;
  return { verdict, confidence, issues, suggestion };
}

/** One model call with all slices as sequential images. Throws on error. */
async function callModel(
  model: string,
  slicesB64: string[],
  userText: string,
): Promise<AiVisualResult> {
  const content: unknown[] = slicesB64.map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/png", data },
  }));
  content.push({ type: "text", text: userText });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
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

  const { verdict, confidence, issues, suggestion } = parseVerdict(text);
  const inputTokens = data.usage?.input_tokens ?? null;
  const outputTokens = data.usage?.output_tokens ?? null;

  return {
    model,
    verdict,
    confidence,
    issues,
    suggestion,
    inputTokens,
    outputTokens,
    costUsd: costOf(model, inputTokens, outputTokens),
    error: null,
  };
}

/**
 * Reviews one page's slices for visual defects. Returns null when no API key is
 * set. Never throws: a failed call (both models) returns an "uncertain" result
 * carrying the error. Haiku primary; Sonnet fallback.
 */
export async function reviewPageVisual(
  input: AiVisualInput,
): Promise<AiVisualResult | null> {
  if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.trim() === "") {
    return null;
  }
  if (input.slicePaths.length === 0) {
    return null;
  }

  let slicesB64: string[];
  try {
    slicesB64 = await Promise.all(
      input.slicePaths.map(async (p) => (await readFile(p)).toString("base64")),
    );
  } catch (err) {
    return {
      model: HAIKU,
      verdict: "uncertain",
      confidence: null,
      issues: [],
      suggestion: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      error: `slice unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const userText =
    `Page: ${input.url} (country=${input.country}, language=${input.language}). ` +
    `${slicesB64.length} slice(s), top to bottom. Report objective visual/layout defects only.`;

  try {
    return await callModel(HAIKU, slicesB64, userText);
  } catch (haikuErr) {
    try {
      return await callModel(SONNET, slicesB64, userText);
    } catch (sonnetErr) {
      const first = haikuErr instanceof Error ? haikuErr.message : String(haikuErr);
      const detail = sonnetErr instanceof Error ? sonnetErr.message : String(sonnetErr);
      return {
        model: SONNET,
        verdict: "uncertain",
        confidence: null,
        issues: [],
        suggestion: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        error: `haiku: ${first}; sonnet: ${detail}`,
      };
    }
  }
}