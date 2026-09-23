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

/**
 * The staff role ladder (055_staff_roles_and_scopes.sql).
 *
 * Declared here rather than in app.types.ts because it IS a database CHECK
 * constraint, and app.types.ts already imports from this file — deriving the
 * other way round would be circular. app.types.ts re-exports it.
 */
export type OrgRole = "owner" | "manager" | "coordinator" | "aux";

/** Every role except `owner`: ownership moves by transfer, never by invitation. */
export type InvitableRole = Exclude<OrgRole, "owner">;

/**
 * What a facility notice is ABOUT (060_facility_status.sql).
 *
 * Orthogonal to `NoticeSeverity`: a staffing problem can be an `info`
 * ("reduced hours") or a `closure` ("no guard available"), and water quality
 * can be either too. Collapsing the two axes into one "type" column forces
 * three of those four real cases to lie — the same mistake migration 046
 * documents for occupancy_kind vs disclosure.
 */
export type NoticeCategory =
  | "water_quality"
  | "mechanical"
  | "staffing"
  | "weather"
  | "maintenance"
  | "capacity"
  | "power"
  | "other";

/**
 * How bad a notice is FOR THE PATRON. Drives colour and whether the schedule
 * beneath it is struck through; never derived from the category.
 */
export type NoticeSeverity = "info" | "caution" | "closure";

/**
 * What a `facility_readings` row measures (061_facility_readings.sql).
 *
 * Head counts and temperatures share one table because they are one object: a
 * number, about a place, at a moment, written down by a person. The migration
 * header has the full argument.
 *
 * Units are fixed and unstored — people, and degrees CELSIUS.
 */
export type ReadingMetric = "headcount" | "water_temp_c" | "air_temp_c";

/**
 * How much of a head count patrons get (`facilities.public_headcount`).
 *
 * `level` is the privacy-preserving one: the exact number never leaves
 * `facility_public_conditions()`, which returns a band instead.
 */
export type PublicHeadcountMode = "hidden" | "count" | "level";

/** The bands `level` mode produces. Thresholds live in `public.occupancy_level`. */
export type OccupancyLevel = "quiet" | "moderate" | "busy" | "full";

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
          /**
           * May aux staff post public facility notices? (migration 060)
           *
           * The one place the read-only aux role can be widened, and an
           * organization's own decision: a lifeguard who finds a contamination
           * either can close the pool to the public or has to phone a
           * supervisor, and both are defensible. Defaults false.
           */
          aux_can_post_notices: boolean;
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
          | "aux_can_post_notices"
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
          aux_can_post_notices?: boolean;
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
          // CHECK (role IN ('owner','manager','coordinator','aux')) as of
          // 055_staff_roles_and_scopes.sql. 'admin' and 'member' are retired.
          role: OrgRole;
          invited_by: string | null;
          joined_at: string;
          // Snapshot of auth.users.email at join time (055), NOT a live join —
          // auth.users is unreadable under RLS, so this is the only way a staff
          // list can say who anyone is. Written once by accept_invitation().
          email: string | null;
          display_name: string | null;
        };
        // role has a DEFAULT 'member'; invited_by is nullable.
        Insert: Omit<
          Database["public"]["Tables"]["org_memberships"]["Row"],
          "id" | "joined_at" | "role" | "invited_by" | "email" | "display_name"
        > & {
          role?: OrgRole;
          invited_by?: string | null;
          email?: string | null;
          display_name?: string | null;
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
          /** Opt-in to the public directory (052); only honoured while published. */
          listed_in_directory: boolean;
          /** When lat/lng were last resolved from the address (052). */
          geocoded_at: string | null;
          /** Publish water/air temperatures on the public page (061). */
          public_conditions: boolean;
          /** How much of the head count patrons get (061). */
          public_headcount: PublicHeadcountMode;
          /** The denominator for `public_headcount = "level"` (061). */
          occupancy_capacity: number | null;
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
          | "listed_in_directory"
          | "geocoded_at"
          | "public_conditions"
          | "public_headcount"
          | "occupancy_capacity"
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
          listed_in_directory?: boolean;
          geocoded_at?: string | null;
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
      department_hours: {
        Row: {
          id: string;
          department_id: string;
          org_id: string;
          // 0=Sunday..6=Saturday, matching getUTCDay() — which is how a
          // session occurrence's weekday must be read (058). A weekday with
          // no row here is closed; there is no is_closed flag.
          day_of_week: number;
          // "HH:MM:SS" from the TIME column. Parse with timeToMinutes()
          // (src/lib/schedule/operating-hours.ts), never with `new Date()`.
          opens_at: string;
          closes_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["department_hours"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["department_hours"]["Insert"]>;
        Relationships: [];
      };
      // Migration 059. NOTE THE INVERSION vs department_hours above: there, a
      // weekday with no rows is CLOSED; here, a date with no row is NORMAL and
      // falls through to the weekly pattern. `observance` is what distinguishes
      // 'closed' from 'normal_hours', since both have zero window rows.
      department_holidays: {
        Row: {
          id: string;
          department_id: string;
          org_id: string;
          /** "YYYY-MM-DD" — a calendar date, no instant, no zone. */
          holiday_date: string;
          name: string;
          observance: "closed" | "custom_hours" | "normal_hours";
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["department_holidays"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["department_holidays"]["Insert"]>;
        Relationships: [];
      };
      department_holiday_windows: {
        Row: {
          id: string;
          holiday_id: string;
          org_id: string;
          /** "HH:MM:SS" from the TIME column — parse with timeToMinutes(). */
          opens_at: string;
          closes_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["department_holiday_windows"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["department_holiday_windows"]["Insert"]>;
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
          /** Free-text grouping label for the Spaces page (migration 054).
           *  Display only — nothing joins to it and it is never bookable. */
          zone_name: string | null;
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
          | "zone_name"
          | "is_published"
        > & {
          department_id?: string | null;
          description?: string | null;
          capacity?: number | null;
          display_order?: number;
          zone_name?: string | null;
          is_published?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["spaces"]["Insert"]>;
        Relationships: [];
      };
      /**
       * What is true at a facility RIGHT NOW (migration 060).
       *
       * Sits ABOVE the schedule: nothing in the expansion pipeline reads it.
       * A notice is live when now() is inside [starts_at, ends_at), and
       * `ends_at` is the only lifecycle column — clearing one sets it to now().
       */
      facility_notices: {
        Row: {
          id: string;
          facility_id: string;
          org_id: string;
          /** NULL = the whole facility; a space id narrows the notice to it. */
          space_id: string | null;
          /** WHAT happened. Orthogonal to severity — see the migration header. */
          category: NoticeCategory;
          /** HOW BAD it is for the patron. Orthogonal to category. */
          severity: NoticeSeverity;
          headline: string;
          body: string | null;
          starts_at: string;
          /** NULL = until cleared. Clearing sets this to now(). */
          ends_at: string | null;
          is_published: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["facility_notices"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "space_id"
          | "body"
          | "starts_at"
          | "ends_at"
          | "is_published"
          | "created_by"
        > & {
          space_id?: string | null;
          body?: string | null;
          starts_at?: string;
          ends_at?: string | null;
          is_published?: boolean;
          created_by?: string | null;
          // There is no updated_at trigger on this table (see 060) — every
          // route stamps it, the way schedule_groups and tags already do.
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["facility_notices"]["Insert"]>;
        Relationships: [];
      };
      /**
       * Head counts and temperatures (migration 061).
       *
       * **Append-only.** There is no UPDATE policy in the database, so the
       * `Update` type below is deliberately `never`: a wrong count is
       * corrected by recording another, and a mistake is deleted.
       */
      facility_readings: {
        Row: {
          id: string;
          facility_id: string;
          org_id: string;
          /** NULL = the whole building. */
          space_id: string | null;
          metric: ReadingMetric;
          /** People, or degrees Celsius. No unit column — see the migration. */
          value: number;
          recorded_at: string;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["facility_readings"]["Row"],
          "id" | "created_at" | "space_id" | "recorded_at"
        > & {
          space_id?: string | null;
          recorded_at?: string;
        };
        /** No UPDATE policy exists. Nothing may edit a recorded observation. */
        Update: never;
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
          // Plain text shown in the public session detail modal (050). No
          // markdown — see the migration header.
          description: string | null;
          default_duration_minutes: number;
          // Seed values for a session placed from this template (047). Defaults,
          // not constraints — sessions.occupancy_kind/disclosure (046) remain the
          // authority once a session exists.
          occupancy_kind: "drop_in" | "program" | "rental" | "closure";
          disclosure: "public" | "reserved" | "internal";
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_templates"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "department_id"
          | "color"
          | "description"
          | "occupancy_kind"
          | "disclosure"
          | "display_order"
          | "is_active"
        > & {
          department_id?: string | null;
          color?: string | null;
          description?: string | null;
          occupancy_kind?: "drop_in" | "program" | "rental" | "closure";
          disclosure?: "public" | "reserved" | "internal";
          display_order?: number;
          is_active?: boolean;
          // Writable: no updated_at trigger on this table, and PATCH sets it on
          // every write so a tags-only or links-only update still touches a row.
          updated_at?: string;
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
      // The facility's tag vocabulary (050). Deliberately a table rather than a
      // text[] on the template: three coordinators typing "Women's Only" three
      // ways makes the public legend useless. Unique per facility on
      // lower(trim(label)).
      tags: {
        Row: {
          id: string;
          org_id: string;
          facility_id: string;
          label: string;
          // NOT NULL, unlike session_templates.color — the colour *is* the
          // legend entry on a printed schedule and has nothing to fall back to.
          color: string;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["tags"]["Row"],
          "id" | "created_at" | "updated_at" | "display_order"
        > & {
          display_order?: number;
          // Writable: there is no updated_at trigger on this table, so a rename
          // or recolour has to set it explicitly (PATCH /api/tags/[id]).
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tags"]["Insert"]>;
        Relationships: [];
      };
      session_template_tags: {
        Row: {
          session_template_id: string;
          tag_id: string;
          org_id: string;
          // Which two reach a session card; the rest go to the detail modal.
          display_order: number;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_template_tags"]["Row"],
          "created_at" | "display_order"
        > & {
          display_order?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["session_template_tags"]["Insert"]
        >;
        Relationships: [];
      };
      session_template_links: {
        Row: {
          id: string;
          session_template_id: string;
          org_id: string;
          // Required, and never substituted by the URL. "Register here", not
          // "https://anc.ca.saanich.bc.ca/mrmfinal/...".
          label: string;
          // http/https only, CHECKed in the database as well as the route —
          // this value ends up in an href on a public page.
          url: string;
          // 0..2, UNIQUE per template. That pair is the "max 3" rule.
          display_order: number;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_template_links"]["Row"],
          "id" | "created_at" | "display_order"
        > & {
          display_order?: number;
        };
        Update: Partial<
          Database["public"]["Tables"]["session_template_links"]["Insert"]
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
          // What this booking does to the space (046). 'drop_in' is residual —
          // it claims whatever is not exclusively claimed; every other value is
          // exclusive. NOT schedule_groups.activity_type, which is a
          // patron-facing descriptor on the group and means something else by
          // the same 'drop_in' string.
          occupancy_kind: "drop_in" | "program" | "rental" | "closure";
          // Who may know this session's name (046). 'reserved' publishes the
          // block and withholds the identity; the identity itself lives in
          // session_internal, which anon cannot read at all.
          disclosure: "public" | "reserved" | "internal";
          // When true, each occurrence's start/end comes from the owning
          // department's department_hours at read time, and a weekday with no
          // window produces no occurrence at all (058). dtstart/dtend_time
          // above are then only an RRULE anchor plus a stale-tolerant
          // snapshot — never read them directly to render a following
          // session; go through expandOccurrenceTimes().
          follows_operating_hours: boolean;
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
          | "occupancy_kind"
          | "disclosure"
          | "follows_operating_hours"
          | "source"
          | "is_active"
        > & {
          template_id?: string | null;
          valid_until?: string | null;
          location_detail?: string | null;
          occupancy_kind?: "drop_in" | "program" | "rental" | "closure";
          disclosure?: "public" | "reserved" | "internal";
          follows_operating_hours?: boolean;
          source?: "manual" | "imported";
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["sessions"]["Insert"]>;
        Relationships: [];
      };
      // Staff-only sidecar (046). No public-read policy exists for this table
      // and none may be added — see the migration's decision 4. Anything
      // selected from here must never be projected onto a public response.
      session_internal: {
        Row: {
          session_id: string;
          org_id: string;
          holder_name: string | null;
          setup_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["session_internal"]["Row"],
          "created_at" | "updated_at" | "holder_name" | "setup_notes"
        > & {
          holder_name?: string | null;
          setup_notes?: string | null;
          // Writable: this schema has no updated_at trigger, so every route
          // that edits a row sets it itself (same as schedule_groups').
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["session_internal"]["Insert"]>;
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
          /** 044: which visitor-facing schedule filters the widget renders. */
          enabled_filters: ("search" | "activity" | "day" | "time" | "space" | "age" | "week")[];
          /** 051: whether visitors get a Print button. */
          allow_print: boolean;
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
          | "enabled_filters"
          | "allow_print"
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
          enabled_filters?: ("search" | "activity" | "day" | "time" | "space" | "age" | "week")[];
          allow_print?: boolean;
          facility_id?: string | null;
          department_id?: string | null;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["widget_configs"]["Insert"]
        >;
        Relationships: [];
      };
      // Added in 043_widget_config_scopes.sql. Sparse by design — a widget
      // config with zero rows here has no filter UI and behaves exactly as
      // before; rows only exist for orgs that opted into the multi-schedule
      // widget. See that migration's header for the RLS shape.
      widget_config_scopes: {
        Row: {
          id: string;
          widget_config_id: string;
          org_id: string;
          label: string;
          facility_id: string;
          department_id: string | null;
          schedule_group_id: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["widget_config_scopes"]["Row"],
          "id" | "department_id" | "schedule_group_id" | "sort_order" | "created_at"
        > & {
          department_id?: string | null;
          schedule_group_id?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["widget_config_scopes"]["Insert"]
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
            | "session_duration"
            // Registration link followed from the session detail modal (050).
            | "link_click";
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
      // Added in 055_staff_roles_and_scopes.sql. What a coordinator or aux
      // staffer can reach. EXACTLY ONE of department_id / facility_id is set
      // (CHECK num_nonnulls = 1): department_id scopes a coordinator,
      // facility_id scopes aux staff.
      //
      // An EMPTY scope list grants NOTHING — see docs/PLAN-staff-roles.md §4.
      membership_scopes: {
        Row: {
          id: string;
          membership_id: string;
          org_id: string;
          department_id: string | null;
          facility_id: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["membership_scopes"]["Row"],
          "id" | "created_at" | "department_id" | "facility_id"
        > & {
          department_id?: string | null;
          facility_id?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["membership_scopes"]["Insert"]
        >;
        Relationships: [];
      };
      // Added in 056_invitation_flow.sql. Mirrors membership_scopes exactly,
      // including the exclusive arc — accept_invitation() copies these rows
      // across verbatim.
      invitation_scopes: {
        Row: {
          id: string;
          invitation_id: string;
          org_id: string;
          department_id: string | null;
          facility_id: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["invitation_scopes"]["Row"],
          "id" | "created_at" | "department_id" | "facility_id"
        > & {
          department_id?: string | null;
          facility_id?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["invitation_scopes"]["Insert"]
        >;
        Relationships: [];
      };
      staff_invitations: {
        Row: {
          id: string;
          org_id: string;
          email: string;
          // CHECK (role IN ('manager','coordinator','aux')) as of
          // 056_invitation_flow.sql — unlike org_memberships, 'owner' is never
          // an invitable role. Ownership moves by transfer_ownership() only.
          role: InvitableRole;
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
          role?: InvitableRole;
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
          /** `approved_at IS NOT NULL` (migration 057). */
          is_verified: boolean;
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
            | "session_duration"
            // Registration link followed from the session detail modal (050).
            | "link_click";
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
      // ── Staff invitations (056_invitation_flow.sql) ────────────────────────
      // Looks an invitation up BY TOKEN. SECURITY DEFINER, so the token is an
      // argument that must be known up front rather than a row filter applied
      // after the grant — an RLS USING clause cannot express "only if you
      // supplied the secret", which was migration 023's CRITICAL finding.
      // Returns no token, no scope rows, and a MASKED email.
      invitation_by_token: {
        Args: { p_token: string };
        Returns: {
          org_name: string;
          org_logo_url: string | null;
          role: InvitableRole;
          email: string;
          scope_count: number;
          expires_at: string;
        }[];
      };
      // Validates, creates the membership with an email snapshot, copies the
      // invitation's scopes across and stamps accepted_at — in ONE transaction.
      // Raises (→ a PostgREST error, message already written for a person) when
      // the token is unknown, used, expired, or was sent to another address.
      accept_invitation: {
        Args: { p_token: string };
        Returns: { joined_org_id: string; joined_role: OrgRole }[];
      };
      // Resigning. Separate from "a manager removed you" because 055 §7 blocks
      // self-modification on org_memberships outright. The owner cannot leave.
      leave_organization: {
        Args: { p_org_id: string };
        Returns: undefined;
      };
      // The only thing that changes an owner row (055 §8). Demote-then-promote
      // in one statement: never zero owners, never two.
      transfer_ownership: {
        Args: { p_org_id: string; p_new_owner_id: string };
        Returns: undefined;
      };
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
      // The public view of a facility's current conditions (061). SECURITY
      // DEFINER: `facility_readings` has no public read policy at all, and in
      // `level` mode the exact head count never leaves this function. Pass the
      // caller's UTC offset (`-new Date().getTimezoneOffset()`) so "usually at
      // this time" buckets on the local weekday and hour.
      facility_public_conditions: {
        Args: { p_facility_id: string; p_utc_offset_minutes?: number };
        Returns: {
          space_id: string | null;
          space_name: string | null;
          metric: ReadingMetric;
          /** NULL in `level` mode — that is the point of the mode. */
          value: number | null;
          /** NULL unless this is a head count in `level` mode. */
          level: OccupancyLevel | null;
          recorded_at: string;
          /** Head counts only, and only with three or more samples. */
          typical_value: number | null;
        }[];
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
