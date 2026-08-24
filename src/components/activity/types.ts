export type ActivityTable =
  | "facilities"
  | "departments"
  | "spaces"
  | "schedule_groups"
  | "sessions"
  | "session_templates";

export type ActivityEntry = {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  table_name: ActivityTable;
  row_id: string;
  action: "insert" | "update" | "delete";
  entity_label: string | null;
  changed_fields: string[] | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reverted_at: string | null;
  reverted_by: string | null;
  created_at: string;
};
