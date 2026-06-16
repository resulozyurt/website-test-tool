/**
 * Zod schema for the manifest published by the WordPress MU/plugin endpoint
 * (GET /wp-json/fieldpie-monitor/v1/manifest). The schema validates the fields
 * we depend on and infers the TypeScript types used throughout the reader.
 *
 * The plugin may add fields over time; unknown extra fields are ignored by
 * default (zod strips them), so forward-compatible additions won't break us.
 */

import { z } from "zod";

export const ManifestLanguageSchema = z.object({
  code: z.string(),
  name: z.string(),
  home_url: z.string(),
  is_default: z.boolean(),
});

export const ManifestPageSchema = z.object({
  key: z.string(),
  language: z.string().nullable(),
  post_id: z.number(),
  url: z.string(),
  heading: z.string().nullable(),
});

export const GeoRuleSchema = z.object({
  post_id: z.number(),
  page: z.string(),
  language: z.string().nullable(),
  element_id: z.string().nullable().optional(),
  element: z.string().nullable().optional(),
  op: z.string(),
  country: z.string(),
  shows: z.string(),
});

export const PlanSchema = z.object({
  language: z.string().nullable(),
  title: z.string(),
  price_monthly: z.string(),
  price_yearly: z.string(),
  period: z.string().nullable(),
  button_text: z.string(),
  is_featured: z.boolean(),
  campaign_text: z.string().nullable(),
});

export const UnrecognizedRuleSchema = z.object({
  post_id: z.number(),
  page: z.string(),
  language: z.string().nullable(),
  dynamic_data: z.string(),
  op: z.string(),
  value: z.string(),
});

export const CoverageSchema = z.object({
  pages_scanned: z.number(),
  templates_scanned: z.number(),
  pages_with_geo_rules: z.number(),
  geo_rule_count: z.number(),
  structural_rule_count: z.number(),
  unrecognized_count: z.number(),
});

export const ManifestSchema = z.object({
  manifest_version: z.string(),
  generated_at: z.string(),
  site: z.string(),
  geo_function: z.string(),
  note: z.string().optional(),
  languages: z.array(ManifestLanguageSchema),
  pages: z.array(ManifestPageSchema),
  geo_rules: z.array(GeoRuleSchema),
  plan_catalog: z.array(PlanSchema),
  unrecognized_rules: z.array(UnrecognizedRuleSchema),
  coverage: CoverageSchema,
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestLanguage = z.infer<typeof ManifestLanguageSchema>;
export type ManifestPage = z.infer<typeof ManifestPageSchema>;
export type GeoRule = z.infer<typeof GeoRuleSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type UnrecognizedRule = z.infer<typeof UnrecognizedRuleSchema>;
