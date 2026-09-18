"use client";

import { useQuery } from "@tanstack/react-query";
import type { OrgRole } from "@/types/app.types";

export interface NavTreeFacility {
  id: string;
  name: string;
  is_published: boolean;
}

export interface NavTreeDepartment {
  id: string;
  name: string;
  is_published: boolean;
  facility_id: string;
}

export interface NavTreeScheduleGroup {
  id: string;
  name: string;
  status: "draft" | "published";
  facility_id: string;
  department_id: string | null;
}

interface NavTreeResponse {
  /**
   * The viewer's role, so the sidebar can stop offering pages they cannot
   * open. Served from /api/nav-tree because it is already fetched once per
   * dashboard load and cached — see that route for why this is presentation
   * rather than a control.
   */
  role: OrgRole;
  facilities: NavTreeFacility[];
  departments: NavTreeDepartment[];
  scheduleGroups: NavTreeScheduleGroup[];
}

async function fetchNavTree(): Promise<NavTreeResponse> {
  const res = await fetch("/api/nav-tree");
  if (!res.ok) throw new Error(`Failed to load navigation tree (${res.status})`);
  return res.json();
}

/**
 * TanStack Query wrapper for /api/nav-tree. Every facility/department/
 * schedule-group mutation should invalidate the ["nav-tree", orgId] key so
 * the sidebar reflects create/edit/delete without a full page reload.
 */
export function useNavTree(orgId: string | undefined) {
  return useQuery({
    queryKey: ["nav-tree", orgId],
    queryFn: fetchNavTree,
    staleTime: 30_000,
    enabled: !!orgId,
  });
}

export function navTreeQueryKey(orgId: string | undefined) {
  return ["nav-tree", orgId] as const;
}
