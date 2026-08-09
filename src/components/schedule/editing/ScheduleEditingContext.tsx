"use client";

import { createContext, useContext } from "react";
import type { ExpandedSession } from "@/types/schedule.types";

/** A session template as offered by the editor's palette, en route to being placed. */
export interface EditorTemplate {
  id: string;
  name: string;
  color: string | null;
  default_duration_minutes: number;
  default_space_ids: string[];
}

/** Where a new session is being placed — day always, space/time only from views that have those axes. */
export interface AddSessionTarget {
  dayCode: string;
  dayLabel: string;
  /** Set from Map, whose columns are real spaces. */
  spaceId?: string;
  spaceName?: string;
  /** Set from Map, whose vertical drop position is a real time. */
  startTime?: string;
  /** Set when dragged from the palette rather than opened from a "+" button. */
  template?: EditorTemplate;
}

export interface RescheduleRequest {
  session: ExpandedSession;
  dayCode: string;
  dayLabel: string;
  startTime: string;
}

/**
 * The editing capabilities a schedule view can offer, or `null` when it is
 * being rendered read-only.
 *
 * This context is the entire difference between the public widget and the
 * dashboard command centre: `WeeklyScheduleGrid`, `WeeklyScheduleList`, and
 * `WeeklyScheduleMap` are *one* component each, used by both. With no
 * provider above them they render exactly as an embedded widget does; with
 * one, the same markup grows "+" buttons, per-session action menus, and (in
 * Map) drag-and-drop. Staff therefore edit the literal thing visitors see
 * rather than a look-alike editor that can drift from it.
 */
export interface ScheduleEditingApi {
  /** Templates placeable in the current scope — empty when the scope spans schedules. */
  templates: EditorTemplate[];
  /** Every space in the current facility, so Map can show empty columns to drop into. */
  spaces: { id: string; name: string }[];
  /** False when the scope spans more than one schedule, since a new session needs exactly one. */
  canCreate: boolean;
  /**
   * False where the surface spans more than one facility. Duplicating offers
   * `spaces`, which is one facility's list — on an org-wide calendar that list
   * is wrong for most of the sessions on screen, so the action is withdrawn
   * rather than silently offered against the wrong building.
   */
  canDuplicate: boolean;
  onAddSession: (target: AddSessionTarget) => void;
  onDuplicate: (session: ExpandedSession) => void;
  onReschedule: (request: RescheduleRequest) => void;
  onDelete: (session: ExpandedSession) => void;
  /** Opens the event/brochure toggles and the copy behind them (session_features). */
  onFeature: (session: ExpandedSession) => void;
  /**
   * Flips `is_event` in place, with no dialog — the realistic flow is "I already
   * built the schedule, now make three of these events". Writes only the flag,
   * so any copy the session already carries is left untouched.
   */
  onToggleEvent: (session: ExpandedSession) => void;
  /** Session currently mid-toggle, so the menu item can show progress. */
  togglingSessionId: string | null;
  deletingSessionId: string | null;
}

const ScheduleEditingContext = createContext<ScheduleEditingApi | null>(null);

export const ScheduleEditingProvider = ScheduleEditingContext.Provider;

/** Returns the editing API, or null when the view is read-only (widget, public pages). */
export function useScheduleEditing(): ScheduleEditingApi | null {
  return useContext(ScheduleEditingContext);
}

/** Where a session's full edit form lives — the one place that URL is built. */
export function sessionEditHref(session: ExpandedSession): string {
  return `/dashboard/sessions/${session.sessionId}/edit`;
}
