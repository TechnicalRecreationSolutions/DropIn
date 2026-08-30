/**
 * Database type definitions for Dropin.
 *
 * Hand-maintained against supabase/migrations/*.sql rather than generated.
 * The Supabase CLI can produce this file directly from the live project
 * (and would correctly populate the FK Relationships arrays this file
 * leaves empty for every table — see the relational-select cast convention
 * used throughout src/app/api, e.g. facility-maps/public/route.ts, which
 * exists to work around that gap):
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts
 *
 * Switching to that would remove the need for those casts entirely. Until
 * then, keep this file in sync with the migrations by hand.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          logo_url: string | null;
          website_url: string | null;
          phone: string | null;
          email: string | null;
          address_line1: string | null;
          city: string | null;
          province: string | null;
          postal_code: string | null;
          country: string;
          status: "pending" | "active" | "suspended";
          approved_at: string | null;
          approved_by: string | null;
          // Added in 007_org_stripe_customer.sql
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        // Only name/slug are required; every other column is nullable and/or
        // has a DB DEFAULT (001_initial_schema.sql, 007_org_stripe_customer.sql).
        Insert: Omit<
          Database["public"]["Tables"]["organizations"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "description"
          | "logo_url"
          | "website_url"
          | "phone"
          | "email"
          | "address_line1"
          | "city"
          | "province"
          | "postal_code"
          | "country"
          | "status"
          | "approved_at"
          | "approved_by"
          | "stripe_customer_id"
        > & {
          description?: string | null;
          logo_url?: string | null;
          website_url?: string | null;
          phone?: string | null;
          email?: string | null;
          address_line1?: string | null;
          city?: string | null;
          province?: string | null;
          postal_code?: string | null;
          country?: string;
          status?: "pending" | "active" | "suspended";
          approved_at?: string | null;
          approved_by?: string | null;
          stripe_customer_id?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["organizations"]["Insert"]
        >;
        Relationships: [];
      };
      org_memberships: {
        Row: {
          id: string;
          org_id: string;
          user_id: string;
          role: "owner" | "admin" | "member";
          invited_by: string | null;
          joined_at: string;
        };
        // role has a DEFAULT 'member'; invited_by is nullable.
        Insert: Omit<
          Database["public"]["Tables"]["org_memberships"]["Row"],
          "id" | "joined_at" | "role" | "invited_by"
        > & {
          role?: "owner" | "admin" | "member";
          invited_by?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["org_memberships"]["Insert"]
        >;
        Relationships: [];
      };
      facilities: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          slug: string;
          description: string | null;
          address_line1: string;
          city: string;
          province: string;
          postal_code: string;
          country: string;
          lat: number | null;
          lng: number | null;
          // GEOGRAPHY(POINT, 4326) — written as a raw WKT string
          // ("POINT(lng lat)") on insert/update; the app never SELECTs it, so
          // its on-read shape (GeoJSON/EWKB via PostgREST) is left untyped.
          location: unknown | null;
          phone: string | null;
          email: string | null;
          website_url: string | null;
          photo_urls: string[];
          amenities: string[];
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["facilities"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "description"
          | "country"
          | "lat"
          | "lng"
          | "location"
          | "phone"
          | "email"
          | "website_url"
          | "photo_urls"
          | "amenities"
          | "is_published"
        > & {
          description?: string | null;
          country?: string;
          lat?: number | null;
          lng?: number | null;
          location?: unknown | null;
          phone?: string | null;
          email?: string | null;
          website_url?: string | null;
          photo_urls?: string[];
          amenities?: string[];
          is_published?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["facilities"]["Insert"]>;
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          facility_id: string;
          org_id: string;
          name: string;
          slug: string;
          description: string | null;
          display_order: number;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["departments"]["Row"],
          "id" | "created_at" | "updated_at" | "description" | "display_order" | "is_published"
        > & {
          description?: string | null;
          display_order?: number;
          is_published?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Insert"]>;
        Relationships: [];
      };
      spaces: {
        Row: {
          id: string;
          org_id: string;
          facility_id: string;
          department_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          capacity: number | null;
          display_order: number;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["spaces"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "department_id"
          | "description"
          | "capacity"
          | "display_order"
          | "is_published"
        > & {
          department_id?: string | null;
          description?: string | null;
          capacity?: number | null;
          display_order?: number;
          is_published?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["spaces"]["Insert"]>;
        Relationships: [];
      };
      facility_maps: {
        Row: {
          id: string;
          org_id: string;
          facility_id: string;
          name: string;
          canvas_width: number;
          canvas_height: number;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        // id is optional (not omitted) — the app upserts onConflict:"id" to
        // replace an existing map row (see /api/facility-maps POST).
        Insert: Omit<
          Database["public"]["Tables"]["facility_maps"]["Row"],
          "id" | "created_at" | "updated_at" | "name" | "canvas_width" | "canvas_height" | "is_published"
        > & {
          id?: string;
          name?: string;
          canvas_width?: number;
          canvas_height?: number;
          is_published?: boolean;
        };
        Update: Partial<
          Database["public"]["Tables"]["facility_maps"]["Insert"]
        >;
        Relationships: [];
      };
      space_hotspots: {
        Row: {
          id: string;
          org_id: string;
          facility_map_id: string;
          space_id: string;
          shape: "rect";
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          label: string | null;
          group_id: string | null;
          lane_index: number | null;
          preset_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["space_hotspots"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "shape"
          | "rotation"
          | "label"
          | "group_id"
          | "lane_index"
          | "preset_key"
        > & {
          shape?: "rect";
          rotation?: number;
          label?: string | null;
          group_id?: string | null;
          lane_index?: number | null;
          preset_key?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["space_hotspots"]["Insert"]
        >;
        Relationships: [];
      };
      map_context_elements: {
        Row: {
          id: string;
          org_id: string;
          facility_map_id: string;
          kind: "zone" | "entrance";
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          label: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["map_context_elements"]["Row"],
          "id" | "created_at" | "updated_at" | "rotation" | "label"
        > & {
          rotation?: number;
          label?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["map_context_elements"]["Insert"]
        >;
        Relationships: [];
      };
      schedule_groups: {
        Row: {
          id: string;
          org_id: string;
          facility_id: string;
          department_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          sport_category: string;
          // 011_collapse_program_into_schedule_group.sql technically added
          // this column without NOT NULL/DEFAULT, but every insert path in
          // the app (dashboard forms, import commit) always supplies a
          // value, and the rest of the app (dashboard pages, public facility
          // page, SessionModal) assumes it's non-null. Kept non-null here to
          // match that established, working assumption rather than
          // introducing null-handling across files outside this task's scope.
          activity_type: "drop_in" | "registered" | "open_gym";
          age_group: string | null;
          skill_level: string | null;
          max_participants: number | null;
          cost_cents: number;
          cost_notes: string | null;
          photo_urls: string[];
          tags: string[];
          display_order: number;
          // Added in 033_schedule_group_status.sql, replacing the old
          // is_published boolean. starts_on/ends_on are nullable — a
          // schedule group can be 'published' with NULL dates if backfill
          // couldn't derive them; the API layer (not a DB constraint) is
          // what blocks a *new* draft->published transition without dates.
          status: "draft" | "published";
          starts_on: string | null;
          ends_on: string | null;
          // Added in 035_schedule_group_modified_tracking.sql. Set only on
          // the transition INTO 'published' (see that migration's header) —
          // never on an ordinary edit to an already-published row. Compared
          // against updated_at to derive the schedule list's MODIFIED state.
          published_at: string | null;
          schedule_type: "time_block" | "continuous";
          continuous_hours_note: string | null;
          source: "manual" | "imported";
          created_at: string;
          updated_at: string;
        };
        // photo_urls, tags, display_order, and schedule_type all have NOT NULL
        // DEFAULT values in the schema (migrations 009, 011, 014); the rest of
        // these are nullable with no default. All are optional on insert.
        Insert: Omit<
          Database["public"]["Tables"]["schedule_groups"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "description"
          | "activity_type"
          | "age_group"
          | "skill_level"
          | "max_participants"
          | "cost_notes"
          | "photo_urls"
          | "tags"
          | "display_order"
          | "schedule_type"
          | "continuous_hours_note"
          | "starts_on"
          | "ends_on"
          | "published_at"
        > & {
          description?: string | null;
          activity_type?: "drop_in" | "registered" | "open_gym" | null;
          age_group?: string | null;
          skill_level?: string | null;
          max_participants?: number | null;
          cost_notes?: string | null;
          photo_urls?: string[];
          tags?: string[];
          display_order?: number;
          schedule_type?: "time_block" | "continuous";
          continuous_hours_note?: string | null;
          starts_on?: string | null;
          ends_on?: string | null;
          published_at?: string | null;
          // DEFAULT NOW() at the DB level, but writable — there is no
          // updated_at trigger on this table for the schedule_groups row
          // itself (session writes bump it via a DB trigger instead, see
          // migration 035), so PATCH /api/schedule-groups/[id] sets it
          // explicitly on every edit.
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["schedule_groups"]["Insert"]
        >;
        Relationships: [];
      };
      // Added in 037_schedule_week_reviews.sql. Sparse by design — a row only
      // exists once a week has been explicitly reviewed; a missing row for a
      // given (schedule_group_id, week_start) is implicitly 'pending'. See
      // that migration's header for why there's no persisted "week" entity.
      schedule_week_reviews: {
        Row: {
          id: string;
          org_id: string;
          schedule_group_id: string;
          week_start: string;
          status: "pending" | "approved" | "needs_changes";
          note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["schedule_week_reviews"]["Row"],
          "id" | "status" | "note" | "reviewed_by" | "reviewed_at" | "created_at" | "updated_at"
        > & {
          status?: "pending" | "approved" | "needs_changes";
          note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["schedule_week_reviews"]["Insert"]
        >;
        Relationships: [];
      };
      session_templates: {
        Row: {
          id: string;
          org_id: string;
          facility_id: string;
          department_id: string | null;
          name: string;
          color: string | null;
          default_duration_minutes: number;
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_templates"]["Row"],
          "id" | "created_at" | "updated_at" | "department_id" | "color" | "display_order" | "is_active"
        > & {
          department_id?: string | null;
          color?: string | null;
          display_order?: number;
          is_active?: boolean;
        };
        Update: Partial<
          Database["public"]["Tables"]["session_templates"]["Insert"]
        >;
        Relationships: [];
      };
      session_template_spaces: {
        Row: {
          session_template_id: string;
          space_id: string;
          org_id: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_template_spaces"]["Row"],
          "created_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["session_template_spaces"]["Insert"]
        >;
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          schedule_group_id: string;
          org_id: string;
          template_id: string | null;
          rrule: string;
          // Local wall-clock date/time, stored as literal UTC-labelled digits
          // with no real timezone meaning (034_remove_timezone.sql). Read with
          // getUTCHours()/getUTCDate()/etc — never convert through an IANA
          // zone. See src/lib/rrule/README.md.
          dtstart: string;
          dtend_time: string;
          valid_from: string;
          valid_until: string | null;
          location_detail: string | null;
          source: "manual" | "imported";
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["sessions"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "template_id"
          | "valid_until"
          | "location_detail"
          | "source"
          | "is_active"
        > & {
          template_id?: string | null;
          valid_until?: string | null;
          location_detail?: string | null;
          source?: "manual" | "imported";
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["sessions"]["Insert"]>;
        Relationships: [];
      };
      session_spaces: {
        Row: {
          session_id: string;
          space_id: string;
          org_id: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_spaces"]["Row"],
          "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["session_spaces"]["Insert"]>;
        Relationships: [];
      };
      session_exceptions: {
        Row: {
          id: string;
          session_id: string;
          org_id: string;
          exception_date: string;
          exception_type: "cancelled" | "modified" | "added";
          modified_start: string | null;
          modified_end: string | null;
          reason: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_exceptions"]["Row"],
          "id" | "created_at" | "modified_start" | "modified_end" | "reason" | "note"
        > & {
          modified_start?: string | null;
          modified_end?: string | null;
          reason?: string | null;
          note?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["session_exceptions"]["Insert"]
        >;
        Relationships: [];
      };
      // Added in 039_session_conflict_dismissals.sql. Only the dismissal is
      // persisted — the conflict itself is computed on demand by
      // findOrgConflicts() (src/lib/sessions/conflicts.ts). session_a_id is
      // always the lexically-lower id (CHECK constraint), matching that
      // function's pairKey ordering.
      session_conflict_dismissals: {
        Row: {
          id: string;
          org_id: string;
          session_a_id: string;
          session_b_id: string;
          note: string | null;
          dismissed_by: string | null;
          dismissed_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_conflict_dismissals"]["Row"],
          "id" | "note" | "dismissed_by" | "dismissed_at"
        > & {
          note?: string | null;
          dismissed_by?: string | null;
          dismissed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["session_conflict_dismissals"]["Insert"]
        >;
        Relationships: [];
      };
      widget_configs: {
        Row: {
          id: string;
          org_id: string;
          primary_color: string;
          secondary_color: string;
          font_family: string;
          show_cost: boolean;
          show_location: boolean;
          show_age_group: boolean;
          time_range_start: string;
          time_range_end: string;
          program_ids: string[] | null;
          custom_title: string | null;
          allowed_templates: ("grid" | "list" | "map" | "floorplan" | "board")[];
          facility_id: string | null;
          department_id: string | null;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["widget_configs"]["Row"],
          | "id"
          | "primary_color"
          | "secondary_color"
          | "font_family"
          | "show_cost"
          | "show_location"
          | "show_age_group"
          | "time_range_start"
          | "time_range_end"
          | "program_ids"
          | "custom_title"
          | "allowed_templates"
          | "facility_id"
          | "department_id"
          | "updated_at"
        > & {
          primary_color?: string;
          secondary_color?: string;
          font_family?: string;
          show_cost?: boolean;
          show_location?: boolean;
          show_age_group?: boolean;
          time_range_start?: string;
          time_range_end?: string;
          program_ids?: string[] | null;
          custom_title?: string | null;
          allowed_templates?: ("grid" | "list" | "map" | "floorplan" | "board")[];
          facility_id?: string | null;
          department_id?: string | null;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["widget_configs"]["Insert"]
        >;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          org_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string | null;
          plan_tier: "free" | "pro" | "enterprise";
          status: string;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["subscriptions"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "stripe_subscription_id"
          | "plan_tier"
          | "status"
          | "current_period_start"
          | "current_period_end"
          | "cancel_at_period_end"
        > & {
          updated_at?: string;
          stripe_subscription_id?: string | null;
          plan_tier?: "free" | "pro" | "enterprise";
          status?: string;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
        };
        Update: Partial<
          Database["public"]["Tables"]["subscriptions"]["Insert"]
        >;
        Relationships: [];
      };
      // Added in 004_stripe_tables.sql — idempotency table for the Stripe
      // webhook handler. Service-role only, no application RLS policies.
      stripe_events: {
        Row: {
          id: string;
          event_id: string;
          event_type: string;
          processed: boolean;
          payload: Json;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["stripe_events"]["Row"],
          "id" | "created_at" | "processed"
        > & {
          processed?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["stripe_events"]["Insert"]>;
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          org_id: string;
          event_type:
            | "widget_view"
            | "program_click"
            | "facility_view"
            | "schedule_view"
            | "view_change"
            | "session_duration";
          // Renamed from program_id in 011_collapse_program_into_schedule_group.sql
          schedule_group_id: string | null;
          facility_id: string | null;
          referrer_url: string | null;
          user_agent: string | null;
          ip_hash: string | null;
          // Added in 041_widget_analytics_expansion.sql
          view_template: "grid" | "list" | "map" | "floorplan" | "board" | null;
          duration_ms: number | null;
          occurred_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["analytics_events"]["Row"],
          "id" | "occurred_at" | "schedule_group_id" | "facility_id" | "referrer_url" | "user_agent" | "ip_hash" | "view_template" | "duration_ms"
        > & {
          schedule_group_id?: string | null;
          facility_id?: string | null;
          referrer_url?: string | null;
          user_agent?: string | null;
          ip_hash?: string | null;
          view_template?: "grid" | "list" | "map" | "floorplan" | "board" | null;
          duration_ms?: number | null;
        };
        // No UPDATE policy exists for this table — writes are insert-only
        // from the public tracking endpoint.
        Update: never;
        Relationships: [];
      };
      staff_invitations: {
        Row: {
          id: string;
          org_id: string;
          email: string;
          // CHECK (role IN ('admin', 'member')) — unlike org_memberships,
          // 'owner' is never an invitable role (001_initial_schema.sql).
          role: "admin" | "member";
          token: string;
          invited_by: string;
          accepted_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["staff_invitations"]["Row"],
          "id" | "token" | "created_at" | "role" | "accepted_at" | "expires_at"
        > & {
          role?: "admin" | "member";
          accepted_at?: string | null;
          expires_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["staff_invitations"]["Insert"]
        >;
        Relationships: [];
      };
      // Added in 038_activity_log.sql. Written only by the log_activity()
      // trigger on facilities/departments/spaces/schedule_groups/sessions/
      // session_templates — never inserted from application code directly.
      activity_log: {
        Row: {
          id: string;
          org_id: string;
          actor_user_id: string | null;
          actor_email: string | null;
          table_name: string;
          row_id: string;
          action: "insert" | "update" | "delete";
          entity_label: string | null;
          changed_fields: string[] | null;
          before: Json | null;
          after: Json | null;
          reverted_at: string | null;
          reverted_by: string | null;
          created_at: string;
        };
        // No Insert type — rows only ever come from the log_activity()
        // trigger (SECURITY DEFINER), which bypasses PostgREST entirely.
        Insert: never;
        // reverted_at/reverted_by are the only columns ever written after
        // the fact, and only via the revert_activity() RPC, not a PATCH.
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      // World-readable projection of active organizations
      // (026_narrow_public_read_policies.sql). The base table is members-only
      // because RLS cannot restrict columns and it holds contact and billing
      // fields. Adding a column here makes it public — see the view's COMMENT.
      organizations_public: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          logo_url: string | null;
          website_url: string | null;
          city: string | null;
          province: string | null;
          country: string;
        };
        Relationships: [];
      };
      // Refreshed nightly via Edge Function (005_analytics_tables.sql,
      // 011_collapse_program_into_schedule_group.sql). Read-only, not
      // currently queried from application code.
      analytics_daily_summary: {
        Row: {
          org_id: string;
          event_type:
            | "widget_view"
            | "program_click"
            | "facility_view"
            | "schedule_view"
            | "view_change"
            | "session_duration";
          schedule_group_id: string | null;
          facility_id: string | null;
          view_template: "grid" | "list" | "map" | "floorplan" | "board" | null;
          day: string;
          event_count: number;
          avg_duration_ms: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      // Atomic fixed-window rate limiter (025_rate_limiting_and_analytics_lockdown.sql).
      // Called only through the service-role client — see src/lib/rate-limit.ts.
      check_rate_limit: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      // Housekeeping for the rate_limits table. Not called from app code.
      sweep_rate_limits: {
        Args: Record<string, never>;
        Returns: number;
      };
      // Undoes a single activity_log entry (038_activity_log.sql). Raises
      // (→ a PostgREST error) if the caller isn't an owner/admin of that
      // entry's org, or if it was already reverted.
      revert_activity: {
        Args: { p_activity_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
};
