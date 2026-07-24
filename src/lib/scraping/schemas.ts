import { z } from "zod";

export const ScrapedProgramSchema = z.object({
  external_id: z.string().min(1),
  name: z.string().min(1),
  sport_category: z.string().min(1),
  activity_type: z.enum(["drop_in", "registered", "open_gym"]),
  age_group: z.string().nullish(),
  skill_level: z.string().nullish(),
  max_participants: z.number().int().positive().nullish(),
  cost_cents: z.number().int().nonnegative().nullish(),
  cost_notes: z.string().nullish(),
  description: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  source_url: z.string().url(),
});

export const ScrapedSessionSchema = z.object({
  external_id: z.string().min(1),
  program_external_id: z.string().min(1),
  rrule: z.string().min(1),
  dtstart: z.string().min(1),
  dtend_time: z.string().min(1),
  timezone: z.string().min(1),
  valid_from: z.string().min(1),
  valid_until: z.string().nullish(),
  location_detail: z.string().nullish(),
  source_url: z.string().url(),
});

export const ScrapingWebhookPayloadSchema = z.object({
  job_id: z.string().uuid(),
  status: z.enum(["completed", "failed"]),
  error_message: z.string().nullish(),
  timestamp: z.string().min(1),
  programs: z.array(ScrapedProgramSchema).default([]),
  sessions: z.array(ScrapedSessionSchema).default([]),
});

export type ScrapingWebhookPayload = z.infer<typeof ScrapingWebhookPayloadSchema>;
export type ScrapedProgram = z.infer<typeof ScrapedProgramSchema>;
export type ScrapedSession = z.infer<typeof ScrapedSessionSchema>;

export const TriggerRequestSchema = z.object({
  config_id: z.string().uuid(),
});

export const ConflictResolveSchema = z.object({
  conflict_ids: z.array(z.string().uuid()).min(1),
  resolution: z.enum(["accepted", "rejected", "ignored"]),
});
