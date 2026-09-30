import { z } from "zod";
import { NOTICE_CATEGORIES, NOTICE_SEVERITIES } from "./notices";

/**
 * The body of POST /api/notice-templates, and (partially) of PATCH. Lives here
 * rather than in the route file because a route module may only export
 * handlers and route config.
 */
export const TemplateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  category: z.enum(NOTICE_CATEGORIES),
  severity: z.enum(NOTICE_SEVERITIES),
  headline: z.string().trim().min(1).max(120),
  body: z.string().max(1000).nullish(),
  /** Empty = every department. */
  department_ids: z.array(z.string().uuid()).max(200).default([]),
});

export const TemplatePatchSchema = TemplateSchema.partial().extend({
  department_ids: z.array(z.string().uuid()).max(200).optional(),
});
