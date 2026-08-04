/**
 * Configuration for the button/link text-vs-target coherence check.
 *
 * The idea: a link whose visible text clearly names a destination ("Pricing",
 * "İletişim", "Book a Demo") should actually point at that destination. When the
 * text strongly implies one place but the href goes somewhere else (most often
 * the home page, or a different known section), that is a real navigation bug we
 * want surfaced in the panel.
 *
 * Everything that decides "which text implies which destination" lives here, so
 * adding a language or a new intent is a one-line change. Matching is
 * accent/locale-tolerant and case-insensitive (see health/coherence.ts).
 *
 * Deliberately conservative to avoid false positives: an intent only fires when
 * its text pattern matches, and a mismatch is only reported when the resolved
 * target contains NONE of the intent's expected tokens AND (for safety) the link
 * is a normal navigation anchor. Ambiguous or unknown text is skipped entirely.
 */

/** One navigation intent: text that names a destination + where it should go. */
export interface LinkIntent {
  /** Stable id, used in the finding message/evidence. */
  id: string;
  /**
   * Case/accent-folded substrings; if the folded link text contains any of
   * these, the link is considered to express this intent. Keep them specific
   * enough not to collide with unrelated copy.
   */
  textIncludes: string[];
  /**
   * Path/URL substrings (folded) that a correct target may contain. A resolved
   * href containing ANY of these is considered coherent. Include every language
   * variant of the slug so a TR page linking to /tr/iletisim/ still passes.
   */
  hrefIncludes: string[];
  /** Human-readable label for the finding message. */
  label: string;
}

/**
 * Ordered intent table. The FIRST intent whose `textIncludes` matches a link's
 * text wins (so put more specific intents before generic ones). Extending:
 * add a new entry, or add a language variant to an existing entry's arrays.
 *
 * Tokens are stored already folded (lowercase, Turkish dotted/dotless I and
 * common accents normalized to plain ASCII) so the analyzer can compare folded
 * strings directly. Keep them lowercase and diacritic-free.
 */
export const LINK_INTENTS: LinkIntent[] = [
  {
    id: "pricing",
    label: "Pricing",
    textIncludes: ["pricing", "fiyatlandirma", "fiyat", "precios", "planlar", "plans", "see plans"],
    hrefIncludes: ["pricing", "fiyatlandirma", "fiyat", "precios", "plans"],
  },
  {
    id: "demo",
    label: "Book a Demo",
    textIncludes: ["book a demo", "get a demo", "request a demo", "demo talep", "demo", "randevu", "agenda una demo", "book a meeting"],
    hrefIncludes: ["demo", "calendly", "get-demo", "getdemo", "meeting", "randevu", "book"],
  },
  {
    id: "contact",
    label: "Contact",
    textIncludes: ["contact", "iletisim", "contacto", "get in touch", "bize ulasin", "bize ulas"],
    hrefIncludes: ["contact", "iletisim", "contacto"],
  },
  {
    id: "login",
    label: "Login / App",
    textIncludes: ["log in", "login", "sign in", "signin", "giris yap", "giris", "oturum", "panele giris"],
    hrefIncludes: ["login", "signin", "sign-in", "app.", "/app", "account", "hesap", "oturum"],
  },
  {
    id: "signup",
    label: "Sign up / Free trial",
    textIncludes: ["free trial", "start free", "sign up", "signup", "ucretsiz dene", "ucretsiz deneyin", "prueba gratis", "kayit ol", "register"],
    hrefIncludes: ["signup", "sign-up", "register", "trial", "get-started", "getstarted", "app.", "/app", "kayit", "start"],
  },
  {
    id: "blog",
    label: "Blog",
    textIncludes: ["blog", "articles", "makaleler", "resources", "kaynaklar"],
    hrefIncludes: ["blog", "articles", "resources", "kaynaklar"],
  },
  {
    id: "about",
    label: "About",
    textIncludes: ["about us", "about", "hakkimizda", "hakkinda", "sobre nosotros", "quienes somos"],
    hrefIncludes: ["about", "hakkimizda", "hakkinda", "sobre", "quienes"],
  },
  {
    id: "careers",
    label: "Careers",
    textIncludes: ["careers", "kariyer", "join us", "we are hiring", "empleo"],
    hrefIncludes: ["careers", "kariyer", "jobs", "hiring", "empleo"],
  },
];

/**
 * Home targets never count as a coherent destination for a named intent (a
 * "Pricing" button pointing at "/" is exactly the bug we want to catch). A
 * resolved href whose path is one of these is treated as "went to home".
 */
export const HOME_PATHS: string[] = ["/", "/tr/", "/es/", "/ar/"];
