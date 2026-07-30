"use client";

import { useQuery } from "@tanstack/react-query";

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
  is_published: boolean;
  facility_id: string;
  department_id: string | null;
}

interface NavTreeResponse {
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
