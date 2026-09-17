-- =============================================================================
-- ROLLBACK for Migration 050
-- =============================================================================
-- Drops the description column, the tag vocabulary and its assignments, the
-- registration links, the public-read policy on session_templates, and the
-- link_click analytics event.
--
-- THIS ONE DESTROYS CONTENT. Unlike 047's rollback, which only lost some
-- pre-fill defaults, running this deletes text staff wrote: every template
-- description, every tag a facility defined (and therefore its printed
-- legend), and every registration link. There is no copy anywhere else —
-- sessions do not carry their own, by design. Take a backup of `tags`,
-- `session_template_tags`, `session_template_links` and
-- `session_templates.description` first, or accept that it is gone.
--
-- The application code must be reverted alongside this. /api/sessions/expand
-- embeds all three, the template form posts them, and the session cards and
-- detail modal read them — they will error once these are gone, not silently
-- degrade.
--
-- Dropping session_templates_public_read restores the pre-050 behaviour where
-- a patron sees the schedule *group* name on every card rather than the
-- template name. That is a visible regression on every public surface, not a
-- return to neutral — see the migration header.
--
-- The link_click rows must go before the CHECK constraint is narrowed, or the
-- ALTER fails on the existing data. That delete is the one irreversible step
-- here that is not staff-authored content.
--
-- This directory is deliberately OUTSIDE supabase/migrations/ so no migration
-- runner picks it up.
-- =============================================================================

DROP POLICY IF EXISTS "session_templates_public_read" ON session_templates;

DROP TABLE IF EXISTS session_template_links;
DROP TABLE IF EXISTS session_template_tags;
DROP TABLE IF EXISTS tags;

ALTER TABLE session_templates
  DROP COLUMN IF EXISTS description;

DELETE FROM analytics_events WHERE event_type = 'link_click';

ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_event_type_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN (
    'widget_view',
    'program_click',
    'facility_view',
    'schedule_view',
    'view_change',
    'session_duration'
  ));
