/**
 * Deterministic content-language assessment (Phase 4a).
 *
 * Answers two questions from a page's visible text, with zero API cost:
 *   1. Is the page's dominant language the one this market/page should serve?
 *      (e.g. a TR page actually rendering English, or an ES/AR page left in
 *      English — a real localization bug.)
 *   2. How much of the content looks FOREIGN to the expected language? (a proxy
 *      for "some sections were never translated".)
 *
 * Method (no dependencies, fully deterministic):
 *   - Script analysis via Unicode ranges decides Arabic vs Latin. Arabic is
 *     script-distinct, so an Arabic page that is mostly Latin letters is an
 *     unambiguous mismatch (and vice-versa).
 *   - For Latin-script languages (en/es/tr) we score short, highly frequent
 *     function words ("stopwords") plus a few language-unique letters/marks
 *     (Turkish ı/ş/ğ/İ, Spanish ñ/¿/¡). The highest score wins when it leads
 *     clearly; otherwise the language is left "unknown" (we never guess on thin
 *     evidence, to avoid false alarms).
 *
 * Intentionally conservative: a mismatch requires a clear signal, so this is
 * safe to gate on. The AI language pass (Phase 4b) covers the subtler cases
 * this cannot (partial/mixed leftovers, text baked into images).
 */

export type Lang = "en" | "tr" | "es" | "ar";

export interface LanguageAssessment {
  expected: Lang;
  /** Best-guess dominant language of the text, or "unknown" when unclear. */
  detected: Lang | "unknown";
  /** True only on a clear "wrong dominant language" signal. */
  mismatch: boolean;
  /** 0..1 share of the signal that looks foreign to `expected` (leftover proxy). */
  foreignRatio: number;
  /** Length of the assessed text (short samples are not assessed). */
  sampleLength: number;
  /** Human-readable explanation, for the finding message. */
  reason: string;
}

/** Highly frequent function words per Latin-script language (discriminative). */
const STOPWORDS: Record<"en" | "es" | "tr", readonly string[]> = {
  en: ["the", "and", "of", "to", "in", "for", "you", "your", "with", "our", "is",
    "are", "this", "that", "we", "on", "or", "by", "from", "get", "start", "free",
    "trial", "book", "demo", "pricing", "learn", "more", "sign", "contact",
    "features", "team", "all", "how", "what", "who", "why"],
  es: ["el", "la", "los", "las", "de", "del", "y", "para", "con", "tu", "su", "es",
    "una", "un", "que", "por", "como", "más", "gratis", "precios", "empezar",
    "funciones", "equipo", "contacto", "cómo", "nuestro", "nuestra", "comienza",
    "prueba", "sobre", "todo", "ver"],
  tr: ["ve", "bir", "için", "ile", "bu", "daha", "çok", "ücretsiz", "deneyin",
    "deneme", "fiyatlandırma", "fiyat", "başla", "başlayın", "iletişim",
    "özellikler", "ekip", "nasıl", "tüm", "sizin", "bizim", "hemen", "hakkında",
    "kaydol", "yeni"],
};

/** ı, ş, ğ and the dotted capital İ strongly imply Turkish (ç/ö/ü are shared). */
const TR_UNIQUE = /[ışğİ]/;
/** ñ and inverted punctuation strongly imply Spanish. */
const ES_UNIQUE = /[ñ¿¡]/;

interface ScriptCounts {
  arabic: number;
  latin: number;
  other: number;
  totalAlpha: number;
}

function scriptCounts(text: string): ScriptCounts {
  let arabic = 0;
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0600 && c <= 0x06ff) {
      arabic += 1;
    } else if (
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 0xc0 && c <= 0x17f)
    ) {
      latin += 1;
    } else if (/\p{L}/u.test(ch)) {
      other += 1;
    }
  }
  return { arabic, latin, other, totalAlpha: arabic + latin + other };
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Assesses whether `rawText` is in the `expected` language. Never throws;
 * returns detected="unknown"/mismatch=false when the sample is too thin.
 */
export function assessLanguage(rawText: string, expected: Lang): LanguageAssessment {
  const text = (rawText || "").replace(/\s+/g, " ").trim();
  const sampleLength = text.length;
  if (sampleLength < 60) {
    return {
      expected,
      detected: "unknown",
      mismatch: false,
      foreignRatio: 0,
      sampleLength,
      reason: "text too short to assess",
    };
  }

  const sc = scriptCounts(text);
  const arabicRatio = sc.totalAlpha ? sc.arabic / sc.totalAlpha : 0;
  const latinRatio = sc.totalAlpha ? sc.latin / sc.totalAlpha : 0;

  // --- Arabic expected: decided purely by script. -------------------------
  if (expected === "ar") {
    const mismatch = arabicRatio < 0.4;
    const detected: Lang | "unknown" =
      arabicRatio >= 0.5 ? "ar" : latinRatio >= 0.5 ? "en" : "unknown";
    return {
      expected,
      detected,
      mismatch,
      foreignRatio: Number(latinRatio.toFixed(2)),
      sampleLength,
      reason: mismatch
        ? `Arabic script is only ${pct(sc.arabic, sc.totalAlpha)}% of letters (Latin ${pct(sc.latin, sc.totalAlpha)}%)`
        : "predominantly Arabic script",
    };
  }

  // --- A Latin-script market that is actually Arabic is a clear mismatch. --
  if (arabicRatio >= 0.4) {
    return {
      expected,
      detected: "ar",
      mismatch: true,
      foreignRatio: Number(arabicRatio.toFixed(2)),
      sampleLength,
      reason: `Arabic script is ${pct(sc.arabic, sc.totalAlpha)}% of letters but expected "${expected}"`,
    };
  }

  // --- Latin-script disambiguation (en/es/tr) via stopwords + unique marks.-
  const tokens = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const score = { en: 0, es: 0, tr: 0 };
  const sets = {
    en: new Set(STOPWORDS.en),
    es: new Set(STOPWORDS.es),
    tr: new Set(STOPWORDS.tr),
  };
  for (const t of tokens) {
    if (sets.en.has(t)) score.en += 1;
    if (sets.es.has(t)) score.es += 1;
    if (sets.tr.has(t)) score.tr += 1;
  }
  if (TR_UNIQUE.test(text)) score.tr += 3;
  if (ES_UNIQUE.test(text)) score.es += 3;

  const ranked = (["en", "es", "tr"] as const)
    .map((l) => ({ l, s: score[l] }))
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];
  const second = ranked[1];
  const totalHits = score.en + score.es + score.tr;

  const detected: Lang | "unknown" =
    totalHits < 3 || top.s === 0 ? "unknown" : top.l;

  // Require a clear lead so we never flip on a couple of shared words.
  const mismatch =
    detected !== "unknown" && detected !== expected && top.s >= second.s + 2;

  const expectedHits = score[expected];
  const foreignRatio = totalHits
    ? Number(((totalHits - expectedHits) / totalHits).toFixed(2))
    : 0;

  const reason =
    detected === "unknown"
      ? "language undetermined (too few signal words)"
      : mismatch
        ? `dominant language looks like "${detected}", expected "${expected}"`
        : `consistent with "${expected}"`;

  return { expected, detected, mismatch, foreignRatio, sampleLength, reason };
}
