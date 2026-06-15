import "dotenv/config";
import { z } from "zod";

/**
 * Central, validated configuration contract for the whole system.
 * Secrets and settings come only from environment variables.
 *
 * Integrations that later phases add (database, storage, email, AI) are
 * optional here so the early phases run without them; each phase that needs a
 * value will check for it explicitly.
 */
const EnvSchema = z.object({
  // --- Target site ---
  TARGET_BASE_URL: z.string().url().default("https://www.fieldpie.com"),
  STAGING_BASE_URL: z.string().url().optional(),

  // --- Country-targeted proxies (full URL: http://user:pass@host:port) ---
  PROXY_US: z.string().optional(),
  PROXY_AE: z.string().optional(),
  PROXY_TR: z.string().optional(),

  // --- Owner allowlist header (lets the monitor through the bot challenge) ---
  MONITOR_HEADER_NAME: z.string().optional(),
  MONITOR_HEADER_VALUE: z.string().optional(),

  // --- Runtime tuning ---
  SETTLE_MS: z.coerce.number().int().positive().default(4000),
  NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),

  // --- Database (Railway Postgres); required from the database phase onward ---
  DATABASE_URL: z.string().optional(),

  // --- Object storage (S3-compatible, e.g. Cloudflare R2); storage phase ---
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),

  // --- Email alerts; alerting phase ---
  ALERT_EMAIL_FROM: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  // --- AI validation; AI phase ---
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed");
}

export const env: Env = parsed.data;