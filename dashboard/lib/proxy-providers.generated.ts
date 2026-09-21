// GENERATED FILE -- do not edit.
// Source: src/config/proxy-providers.ts
// Run `npm run catalog:sync` in the repository root after changing it.

/**
 * Proxy provider catalogue.
 *
 * Every provider reaches the same place -- an authenticated HTTP gateway --
 * but each one encodes "which country" and "which sticky session" differently,
 * and in a different field: DataImpulse and Decodo put both in the username,
 * Evomi and IPRoyal put both in the password. Hard-coding those variants (as
 * withFreshSession used to, with one branch per provider) does not survive a
 * third provider, so the differences live here as data.
 *
 * Formats verified from each provider's own documentation (September 2026);
 * Evomi's from this project's own working configuration. They can still
 * change, which is why `custom` exists and why nothing is activated before a
 * live test confirms the exit country.
 */

export type CountryCode = "US" | "AE" | "TR";

/** One credential the operator has to supply for a provider. */
export interface ProviderField {
  key: string;
  label: string;
  /** Shown under the field: where to find this value. */
  help: string;
  example?: string;
  /** Masked in the UI and never returned by the API once saved. */
  secret?: boolean;
}

/** Where a provider keeps its sticky-session id. */
export interface SessionSpec {
  field: "username" | "password";
  /** Literal text before the id, e.g. ";sessid." or "_session-". */
  prefix: string;
  /** Literal text after the id, if any (before the next parameter). */
  suffix: string;
  /** Required id length; IPRoyal rejects anything other than 8. */
  length: number;
}

export interface ProviderDef {
  id: string;
  name: string;
  /** Fixed gateway, or null when the operator must supply one (Bright Data). */
  host: string | null;
  port: number | null;
  pricingUrl: string;
  /** ISO country code casing this provider expects. */
  countryCase: "lower" | "upper";
  fields: ProviderField[];
  /** Templates over {field} placeholders plus {country} and {session}. */
  usernameTemplate: string;
  passwordTemplate: string;
  session: SessionSpec;
  /** One line shown above the form in the panel. */
  setupHint: string;
}

const PASSWORD_FIELD: ProviderField = {
  key: "password",
  label: "Parola",
  help: "Sağlayıcı panelindeki proxy kullanıcısının parolası.",
  secret: true,
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "dataimpulse",
    name: "DataImpulse",
    host: "gw.dataimpulse.com",
    port: 823,
    pricingUrl: "https://dataimpulse.com/residential-proxies/",
    countryCase: "lower",
    fields: [
      {
        key: "login",
        label: "Login",
        help: "DataImpulse panelinde oluşturduğun alt kullanıcının login'i.",
        example: "abc12345",
      },
      PASSWORD_FIELD,
    ],
    usernameTemplate: "{login}__cr.{country};sessid.{session}",
    passwordTemplate: "{password}",
    session: { field: "username", prefix: ";sessid.", suffix: "", length: 8 },
    setupHint:
      "Ülke ve oturum kullanıcı adının içine yazılır (__cr.tr;sessid.xxxx).",
  },
  {
    id: "evomi",
    name: "Evomi",
    host: "core-residential.evomi.com",
    port: 1000,
    pricingUrl: "https://evomi.com/product/residential-proxies",
    countryCase: "upper",
    fields: [
      {
        key: "username",
        label: "Kullanıcı adı",
        help: "Evomi panelindeki residential ürününün kullanıcı adı.",
      },
      PASSWORD_FIELD,
    ],
    usernameTemplate: "{username}",
    passwordTemplate: "{password}_country-{country}_session-{session}_lifetime-30m",
    session: { field: "password", prefix: "_session-", suffix: "_lifetime-", length: 8 },
    setupHint:
      "Ülke, oturum ve oturum ömrü parolanın sonuna parametre olarak eklenir.",
  },
  {
    id: "iproyal",
    name: "IPRoyal",
    host: "geo.iproyal.com",
    port: 12321,
    pricingUrl: "https://iproyal.com/residential-proxies/",
    countryCase: "lower",
    fields: [
      {
        key: "username",
        label: "Kullanıcı adı",
        help: "IPRoyal panelinde Residential ürününün kullanıcı adı.",
      },
      PASSWORD_FIELD,
    ],
    usernameTemplate: "{username}",
    passwordTemplate: "{password}_country-{country}_session-{session}_lifetime-30m",
    // IPRoyal rejects a session id that is not exactly 8 characters.
    session: { field: "password", prefix: "_session-", suffix: "_lifetime-", length: 8 },
    setupHint:
      "Parola alanına parametre eklenir; oturum kimliği tam 8 karakter olmalı.",
  },
  {
    id: "decodo",
    name: "Decodo (eski Smartproxy)",
    host: "gate.decodo.com",
    port: 7000,
    pricingUrl: "https://decodo.com/proxies/residential-proxies",
    countryCase: "lower",
    fields: [
      {
        key: "username",
        label: "Kullanıcı adı",
        help: "Decodo panelindeki proxy kullanıcısı (başındaki 'user-' otomatik eklenir).",
      },
      PASSWORD_FIELD,
    ],
    usernameTemplate:
      "user-{username}-country-{country}-session-{session}-sessionduration-30",
    passwordTemplate: "{password}",
    session: { field: "username", prefix: "-session-", suffix: "-sessionduration-", length: 10 },
    setupHint: "Tüm parametreler kullanıcı adına tire ile eklenir.",
  },
  {
    id: "oxylabs",
    name: "Oxylabs",
    host: "pr.oxylabs.io",
    port: 7777,
    pricingUrl: "https://oxylabs.io/products/residential-proxy-pool",
    countryCase: "upper",
    fields: [
      {
        key: "username",
        label: "Customer kullanıcı adı",
        help: "Oxylabs panelindeki alt kullanıcı (başındaki 'customer-' otomatik eklenir).",
      },
      PASSWORD_FIELD,
    ],
    usernameTemplate: "customer-{username}-cc-{country}-sessid-{session}-sesstime-10",
    passwordTemplate: "{password}",
    session: { field: "username", prefix: "-sessid-", suffix: "-sesstime-", length: 10 },
    setupHint: "Ülke 'cc-', oturum 'sessid-' ile kullanıcı adına eklenir.",
  },
  {
    id: "brightdata",
    name: "Bright Data",
    host: null,
    port: null,
    pricingUrl: "https://brightdata.com/proxy-types/residential-proxies",
    countryCase: "lower",
    fields: [
      {
        key: "host",
        label: "Gateway host",
        help: "Zone'un erişim sayfasında yazar. Genellikle brd.superproxy.io.",
        example: "brd.superproxy.io",
      },
      {
        key: "port",
        label: "Port",
        help: "Zone'un erişim sayfasındaki port. Genellikle 33335.",
        example: "33335",
      },
      {
        key: "customerId",
        label: "Customer ID",
        help: "Panelde 'brd-customer-' sonrasındaki kimlik.",
      },
      { key: "zone", label: "Zone adı", help: "Residential zone'un adı." },
      { key: "password", label: "Zone parolası", help: "Zone'a ait parola.", secret: true },
    ],
    usernameTemplate:
      "brd-customer-{customerId}-zone-{zone}-country-{country}-session-{session}",
    passwordTemplate: "{password}",
    session: { field: "username", prefix: "-session-", suffix: "", length: 10 },
    setupHint:
      "Önce panelde bir residential zone oluştur; host ve port o zone'un erişim sayfasında yazar.",
  },
  {
    id: "custom",
    name: "Özel (ham şablon)",
    host: null,
    port: null,
    pricingUrl: "",
    countryCase: "lower",
    fields: [
      { key: "host", label: "Gateway host", help: "Örn. gw.saglayici.com" },
      { key: "port", label: "Port", help: "Örn. 8000" },
      {
        key: "usernameTemplate",
        label: "Kullanıcı adı şablonu",
        help: "{country} ve {session} yer tutucularını kullanabilirsin.",
        example: "kullanici-country-{country}-session-{session}",
      },
      {
        key: "passwordTemplate",
        label: "Parola şablonu",
        help: "Parametre parolaya giriyorsa burada kullan.",
        example: "parola",
        secret: true,
      },
    ],
    usernameTemplate: "{usernameTemplate}",
    passwordTemplate: "{passwordTemplate}",
    session: { field: "username", prefix: "", suffix: "", length: 10 },
    setupHint:
      "Katalogdaki bir sağlayıcı şablonunu değiştirdiyse ya da listede yoksa burayı kullan.",
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** A random sticky-session id of the length the provider demands. */
export function newSessionId(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function fill(
  template: string,
  values: Record<string, string>,
  country: string,
  session: string,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (key === "country") return country;
    if (key === "session") return session;
    return values[key] ?? "";
  });
}

/** The gateway a configured provider connects to, honouring user-supplied hosts. */
export function gatewayOf(
  provider: ProviderDef,
  credentials: Record<string, string>,
): { host: string; port: number } | null {
  const host = provider.host ?? credentials.host?.trim();
  const portRaw = provider.port ?? Number(credentials.port);
  if (!host || !portRaw || Number.isNaN(Number(portRaw))) {
    return null;
  }
  return { host, port: Number(portRaw) };
}

export interface BuiltProxy {
  server: string;
  username: string;
  password: string;
}

/**
 * Turns stored credentials into a concrete proxy for one country. Throws with
 * a readable message rather than producing a half-built URL, because a
 * silently wrong proxy means silently testing the wrong country.
 */
export function buildProxy(
  provider: ProviderDef,
  credentials: Record<string, string>,
  country: CountryCode,
  sessionId?: string,
): BuiltProxy {
  const gateway = gatewayOf(provider, credentials);
  if (!gateway) {
    throw new Error(`${provider.name}: gateway host/port missing`);
  }
  const cc =
    provider.countryCase === "upper"
      ? country.toUpperCase()
      : country.toLowerCase();
  const session = sessionId ?? newSessionId(provider.session.length);
  return {
    server: `http://${gateway.host}:${gateway.port}`,
    username: fill(provider.usernameTemplate, credentials, cc, session),
    password: fill(provider.passwordTemplate, credentials, cc, session),
  };
}
