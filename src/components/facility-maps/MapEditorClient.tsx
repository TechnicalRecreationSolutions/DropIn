"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Undo2, Redo2, Smartphone, X } from "lucide-react";
import ShapeCanvas, { type EditableShape, type EditableContextElement } from "./ShapeCanvas";
import ShapePalette from "./ShapePalette";
import ShapeAssignmentList from "./ShapeAssignmentList";
import FacilityMapSvg from "./renderer/FacilityMapSvg";
import { placementRect, type ArmedPlacement, type ContextItem } from "./placement";
import type { ShapePreset } from "@/lib/facility-shapes/presets";

interface MapEditorClientProps {
  facilityId: string;
  spaces: { id: string; name: string }[];
}

interface FacilityMapRow {
  id: string;
  canvas_width: number;
  canvas_height: number;
  is_published: boolean;
}

interface MapState {
  shapes: EditableShape[];
  contexts: EditableContextElement[];
}

const HISTORY_LIMIT = 50;

/**
 * Facility map authoring UI — arm a preset or context item in ShapePalette,
 * then tap the canvas (rendered by the same engine visitors see) to place
 * it there. Placed shapes support snap/undo/keyboard editing, then publish.
 * Follows the dashboard's authoring convention: local editing state, saved
 * via fetch() to REST routes, then invalidating the relevant query keys.
 *
 * Spaces are created inline when a preset needs more than exist — placing
 * a 6-lane pool on a facility with no spaces just works (names "Lane 1…6"
 * are created unpublished via POST /api/spaces) instead of erroring out
 * with "add more spaces first".
 *
 * Publishing guards the floorplan's core promise: an unpublished space is
 * invisible to the public sessions join, so its hotspot could never show
 * live status. If any mapped space is unpublished at publish time, a
 * confirm step offers to publish them together with the map.
 *
 * Undo/redo history records a snapshot per completed gesture or atomic
 * edit (ShapeCanvas's onCommit), not per drag frame — Ctrl+Z / Ctrl+Shift+Z
 * or the toolbar buttons.
 */
export default function MapEditorClient({ facilityId, spaces: initialSpaces }: MapEditorClientProps) {
  const queryClient = useQueryClient();
  const [shapes, setShapes] = useState<EditableShape[]>([]);
  const [contexts, setContexts] = useState<EditableContextElement[]>([]);
  const [spaces, setSpaces] = useState(initialSpaces);
  // Queued placements outlive the render that created them — they read
  // spaces through this ref so names/numbering see just-created rows.
  const spacesRef = useRef(initialSpaces);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [creatingMap, setCreatingMap] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [publishPrompt, setPublishPrompt] = useState<{ unpublished: { id: string; name: string }[] } | null>(null);
  // Which palette card is armed for tap-to-place — stays set after a
  // placement so several of the same shape can be dropped in a row; the
  // user cancels via the card, Escape, or picking something else.
  const [armed, setArmed] = useState<ArmedPlacement | null>(null);

  // History: refs hold the machinery (mutated in handlers only); a version
  // counter re-renders the undo/redo buttons.
  const liveRef = useRef<MapState>({ shapes: [], contexts: [] });
  const committedRef = useRef<MapState>({ shapes: [], contexts: [] });
  const pastRef = useRef<MapState[]>([]);
  const futureRef = useRef<MapState[]>([]);
  // Mirrors the history stacks' depths — refs can't be read during render.
  const [historyDepth, setHistoryDepth] = useState({ past: 0, future: 0 });

  const { data: facilityMap, isLoading } = useQuery({
    queryKey: ["facility-map-admin", facilityId],
    queryFn: async () => {
      const res = await fetch(`/api/facility-maps?facilityId=${facilityId}`);
      if (!res.ok) throw new Error(`Failed to load facility map (${res.status})`);
      const data = await res.json();
      return data.facilityMap as FacilityMapRow | null;
    },
  });

  const { data: existingShapes } = useQuery({
    queryKey: ["facility-map-hotspots-admin", facilityMap?.id],
    queryFn: async () => {
      const res = await fetch(`/api/facility-maps/${facilityMap!.id}/hotspots`);
      if (!res.ok) throw new Error(`Failed to load shapes (${res.status})`);
      const data = await res.json();
      return data.hotspots as {
        id: string;
        space_id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        label: string | null;
        preset_key: string;
        group_id: string | null;
        lane_index: number | null;
      }[];
    },
    enabled: !!facilityMap?.id,
  });

  const { data: existingContexts } = useQuery({
    queryKey: ["facility-map-contexts-admin", facilityMap?.id],
    queryFn: async () => {
      const res = await fetch(`/api/facility-maps/${facilityMap!.id}/context-elements`);
      if (!res.ok) throw new Error(`Failed to load context elements (${res.status})`);
      const data = await res.json();
      return data.contextElements as {
        id: string;
        kind: "zone" | "entrance";
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        label: string | null;
      }[];
    },
    enabled: !!facilityMap?.id,
  });

  // Seed local editing state from the loaded rows — legitimate one-time
  // sync from query result to editable state, same pattern as WidgetConfigurator.
  useEffect(() => {
    if (!existingShapes) return;
    const seeded = existingShapes.map((s) => ({
      key: s.id,
      space_id: s.space_id,
      x: Number(s.x),
      y: Number(s.y),
      width: Number(s.width),
      height: Number(s.height),
      rotation: Number(s.rotation),
      label: s.label,
      presetKey: s.preset_key ?? "generic-large",
      groupId: s.group_id,
      laneIndex: s.lane_index,
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShapes(seeded);
    liveRef.current = { ...liveRef.current, shapes: seeded };
    committedRef.current = { ...committedRef.current, shapes: seeded };
    setDirty(false);
  }, [existingShapes]);

  useEffect(() => {
    if (!existingContexts) return;
    const seeded = existingContexts.map((c) => ({
      key: c.id,
      kind: c.kind,
      x: Number(c.x),
      y: Number(c.y),
      width: Number(c.width),
      height: Number(c.height),
      rotation: Number(c.rotation),
      label: c.label,
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContexts(seeded);
    liveRef.current = { ...liveRef.current, contexts: seeded };
    committedRef.current = { ...committedRef.current, contexts: seeded };
    setDirty(false);
  }, [existingContexts]);

  // ---- History -------------------------------------------------------------

  const applyLive = useCallback((next: MapState) => {
    liveRef.current = next;
    setShapes(next.shapes);
    setContexts(next.contexts);
    setDirty(true);
  }, []);

  const commit = useCallback(() => {
    pastRef.current.push(committedRef.current);
    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
    futureRef.current = [];
    committedRef.current = liveRef.current;
    setHistoryDepth({ past: pastRef.current.length, future: 0 });
  }, []);

  // Async placements (space creation awaits network calls) can overlap —
  // committing an updater applied to the CURRENT live state, rather than a
  // state snapshot captured when the handler started, keeps two in-flight
  // placements from clobbering each other's shapes.
  const applyCommitted = useCallback(
    (updater: (current: MapState) => MapState) => {
      applyLive(updater(liveRef.current));
      commit();
    },
    [applyLive, commit]
  );

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(committedRef.current);
    committedRef.current = prev;
    applyLive(prev);
    setHistoryDepth({ past: pastRef.current.length, future: futureRef.current.length });
  }, [applyLive]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(committedRef.current);
    committedRef.current = next;
    applyLive(next);
    setHistoryDepth({ past: pastRef.current.length, future: futureRef.current.length });
  }, [applyLive]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        // Global, not just canvas-focused — armed a card by clicking it,
        // focus can still be on that button when Escape is pressed.
        setArmed((current) => (current ? null : current));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo, redo]);

  const canUndo = historyDepth.past > 0;
  const canRedo = historyDepth.future > 0;

  // ---- Space provisioning --------------------------------------------------

  // Placements await network calls (map creation, space creation), so two
  // quick drops can interleave — the second reading half-updated assignment
  // state and stealing a space the first just claimed. Placements are rare
  // and order matters less than atomicity, so they run through a serial
  // queue instead of fine-grained locking.
  const placementQueueRef = useRef<Promise<void>>(Promise.resolve());
  function enqueuePlacement(work: () => Promise<void>): Promise<void> {
    const next = placementQueueRef.current.then(work, work);
    placementQueueRef.current = next;
    return next;
  }

  /** Creates a space (unpublished), retrying with numeric suffixes on name conflicts. */
  async function createSpace(baseName: string): Promise<{ id: string; name: string } | null> {
    const taken = new Set(spacesRef.current.map((s) => s.name.toLowerCase()));
    let candidate = baseName;
    let suffix = 2;
    while (taken.has(candidate.toLowerCase())) candidate = `${baseName} ${suffix++}`;

    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facility_id: facilityId, name: candidate }),
      });
      if (res.ok) {
        const data = await res.json();
        const space = { id: data.space.id as string, name: data.space.name as string };
        spacesRef.current = [...spacesRef.current, space];
        setSpaces(spacesRef.current);
        return space;
      }
      candidate = `${baseName} ${suffix++}`;
    }
    return null;
  }

  /** Next free "Lane N" number across existing space names. */
  function nextLaneNumber(): number {
    let max = 0;
    for (const s of spacesRef.current) {
      const m = /^Lane (\d+)$/i.exec(s.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  async function provisionSpaces(count: number, laneNaming: boolean, fallbackName: string) {
    // Read assignment through the refs — component state may predate a
    // just-finished queued placement.
    const assigned = new Set(liveRef.current.shapes.map((s) => s.space_id));
    const available = spacesRef.current.filter((s) => !assigned.has(s.id));
    const result = [...available.slice(0, count)];
    let laneStart = nextLaneNumber();
    while (result.length < count) {
      const created = await createSpace(laneNaming ? `Lane ${laneStart++}` : fallbackName);
      if (!created) return null;
      result.push(created);
    }
    return result;
  }

  // ---- Map + placement -----------------------------------------------------

  async function ensureFacilityMap(): Promise<FacilityMapRow | null> {
    if (facilityMap) return facilityMap;
    setCreatingMap(true);
    setSaveError(null);
    const res = await fetch("/api/facility-maps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facility_id: facilityId }),
    });
    setCreatingMap(false);
    if (!res.ok) {
      setSaveError("Could not create the facility map. Please try again.");
      return null;
    }
    const data = await res.json();
    queryClient.setQueryData(["facility-map-admin", facilityId], data.facilityMap);
    return data.facilityMap as FacilityMapRow;
  }

  /** Fires when the canvas is tapped while a palette card is armed. */
  function handleCanvasPlace(dropFraction: { x: number; y: number }) {
    if (!armed) return;
    if (armed.kind === "preset") enqueuePlacement(() => placePreset(armed.preset, dropFraction));
    else enqueuePlacement(() => placeContext(armed.item, dropFraction));
  }

  async function placePreset(preset: ShapePreset, dropFraction: { x: number; y: number }) {
    const map = await ensureFacilityMap();
    if (!map) return;

    setSaveError(null);
    const targetSpaces = await provisionSpaces(preset.laneCount, preset.laneCount > 1, preset.label);
    if (!targetSpaces) {
      setSaveError("Could not create spaces for this shape. Please try again.");
      return;
    }

    const rect = placementRect(preset.widthM, preset.heightM, map.canvas_width, map.canvas_height, dropFraction);

    // A single-lane preset (laneCount 1) is just a group of one — same
    // shape, no groupId/laneIndex, matching every standalone shape today.
    const groupId = preset.laneCount > 1 ? crypto.randomUUID() : null;
    const newShapes: EditableShape[] = Array.from({ length: preset.laneCount }, (_, i) => ({
      key: crypto.randomUUID(),
      space_id: targetSpaces[i].id,
      ...rect,
      rotation: 0,
      label: groupId ? targetSpaces[i].name : preset.label,
      presetKey: preset.key,
      groupId,
      laneIndex: groupId ? i : null,
    }));

    applyCommitted((current) => ({ ...current, shapes: [...current.shapes, ...newShapes] }));
  }

  async function placeContext(item: ContextItem, dropFraction: { x: number; y: number }) {
    const map = await ensureFacilityMap();
    if (!map) return;

    const rect = placementRect(item.widthM, item.heightM, map.canvas_width, map.canvas_height, dropFraction);
    const next: EditableContextElement = {
      key: crypto.randomUUID(),
      kind: item.kind,
      ...rect,
      rotation: 0,
      label: item.kind === "entrance" ? null : "Zone",
    };
    applyCommitted((current) => ({ ...current, contexts: [...current.contexts, next] }));
  }

  function handleDuplicate(source: EditableShape) {
    return enqueuePlacement(() => duplicateShape(source));
  }

  async function duplicateShape(source: EditableShape) {
    setSaveError(null);
    const currentShapes = liveRef.current.shapes;
    const members = source.groupId
      ? currentShapes.filter((s) => s.groupId === source.groupId)
      : [source];
    const targetSpaces = await provisionSpaces(
      members.length,
      members.length > 1,
      `${source.label ?? "Shape"} copy`
    );
    if (!targetSpaces) {
      setSaveError("Could not create a space for the duplicate. Please try again.");
      return;
    }

    const offsetX = Math.min(1 - source.width, source.x + 0.5 / (facilityMap?.canvas_width ?? 25));
    const offsetY = Math.min(1 - source.height, source.y + 0.5 / (facilityMap?.canvas_height ?? 15));
    const newGroupId = source.groupId ? crypto.randomUUID() : null;
    const copies: EditableShape[] = members.map((m, i) => ({
      ...m,
      key: crypto.randomUUID(),
      space_id: targetSpaces[i].id,
      x: offsetX,
      y: offsetY,
      label: newGroupId ? targetSpaces[i].name : m.label,
      groupId: newGroupId,
      laneIndex: newGroupId ? i : null,
    }));

    applyCommitted((current) => ({ ...current, shapes: [...current.shapes, ...copies] }));
  }

  // ---- Save + publish ------------------------------------------------------

  async function handleSave() {
    if (!facilityMap) return;
    setSaving(true);
    setSaveError(null);
    const [shapesRes, contextsRes] = await Promise.all([
      fetch(`/api/facility-maps/${facilityMap.id}/hotspots`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotspots: shapes.map((s) => ({
            space_id: s.space_id,
            x: s.x,
            y: s.y,
            width: s.width,
            height: s.height,
            rotation: s.rotation,
            label: s.label,
            preset_key: s.presetKey,
            group_id: s.groupId,
            lane_index: s.laneIndex,
          })),
        }),
      }),
      fetch(`/api/facility-maps/${facilityMap.id}/context-elements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextElements: contexts.map((c) => ({
            kind: c.kind,
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height,
            rotation: c.rotation,
            label: c.label,
          })),
        }),
      }),
    ]);
    setSaving(false);
    if (!shapesRes.ok || !contextsRes.ok) {
      const body = await (shapesRes.ok ? contextsRes : shapesRes).json().catch(() => ({}));
      setSaveError(body.error ?? "Could not save the facility map.");
      return;
    }
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ["facility-map-hotspots-admin", facilityMap.id] });
    queryClient.invalidateQueries({ queryKey: ["facility-map-contexts-admin", facilityMap.id] });
    queryClient.invalidateQueries({ queryKey: ["facility-map", facilityId] });
  }

  async function setMapPublished(published: boolean) {
    if (!facilityMap) return;
    const res = await fetch(`/api/facility-maps/${facilityMap.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: published }),
    });
    if (!res.ok) {
      setSaveError("Could not update publish state.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["facility-map-admin", facilityId] });
    queryClient.invalidateQueries({ queryKey: ["facility-map", facilityId] });
  }

  async function handleTogglePublish() {
    if (!facilityMap) return;
    setSaveError(null);
    if (facilityMap.is_published) {
      await setMapPublished(false);
      return;
    }
    // An unpublished space is invisible to the public sessions join, so its
    // hotspot could never light up — surface that before going live.
    const res = await fetch(`/api/spaces?facilityId=${facilityId}`);
    if (res.ok) {
      const data = await res.json();
      const mappedIds = new Set(shapes.map((s) => s.space_id));
      const unpublished = (data.spaces as { id: string; name: string; is_published: boolean }[])
        .filter((s) => mappedIds.has(s.id) && !s.is_published)
        .map((s) => ({ id: s.id, name: s.name }));
      if (unpublished.length > 0) {
        setPublishPrompt({ unpublished });
        return;
      }
    }
    await setMapPublished(true);
  }

  async function confirmPublish(alsoPublishSpaces: boolean) {
    const prompt = publishPrompt;
    setPublishPrompt(null);
    if (alsoPublishSpaces && prompt) {
      await Promise.all(
        prompt.unpublished.map((s) =>
          fetch(`/api/spaces/${s.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_published: true }),
          })
        )
      );
    }
    await setMapPublished(true);
  }

  // ---- Render --------------------------------------------------------------

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-muted-foreground/70">Loading…</div>;
  }

  const canvasWidth = facilityMap?.canvas_width ?? 25;
  const canvasHeight = facilityMap?.canvas_height ?? 15;
  const assignedSpaceIds = new Set(shapes.map((s) => s.space_id));
  const allSpacesPlaced = spaces.length > 0 && spaces.every((s) => assignedSpaceIds.has(s.id));

  return (
    <div className="max-w-[1000px] mx-auto space-y-4">
      {/* One toolbar strip instead of a floating caption + floating buttons —
          reads as a single control bar for the editor below it. */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-card rounded-xl border border-border shadow-sm px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Build a map of this facility — visitors will tap it to see what&apos;s happening where.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowPreview(true)}
            disabled={shapes.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <Smartphone className="w-4 h-4" /> Preview
          </button>
          {facilityMap && (
            <button
              onClick={handleTogglePublish}
              className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                facilityMap.is_published
                  ? "border border-border text-foreground hover:bg-muted"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {facilityMap.is_published ? (
                <>
                  <EyeOff className="w-4 h-4" /> Unpublish
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4" /> Publish
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Canvas and palette side by side on wide screens: the palette is
          what you reach for on every placement, so it's sticky next to the
          canvas rather than trailing below it. The placed-shape settings
          list and Save button live in the LEFT column, stacked directly
          under the canvas — not as a full-width row below the whole grid,
          which (when the palette column runs taller than the canvas, as it
          usually does with 5 categories of presets) left a large dead gap
          between the canvas and that list. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,720px)_260px] gap-4 items-start">
        <div className="space-y-4">
          <div className="bg-card rounded-2xl border border-border shadow-sm p-3">
            <ShapeCanvas
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              shapes={shapes}
              contextElements={contexts}
              spaces={spaces}
              onChange={(nextShapes, nextContexts) => applyLive({ shapes: nextShapes, contexts: nextContexts })}
              onCommit={commit}
              onDuplicate={handleDuplicate}
              armed={armed}
              onPlace={handleCanvasPlace}
              onCancelArm={() => setArmed(null)}
            />
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <ShapeAssignmentList
            shapes={shapes}
            contextElements={contexts}
            spaces={spaces}
            onChange={(nextShapes, nextContexts) => applyLive({ shapes: nextShapes, contexts: nextContexts })}
            onCommit={commit}
          />

          <button
            onClick={handleSave}
            disabled={!dirty || saving || !facilityMap}
            className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save map"}
          </button>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <ShapePalette disabled={creatingMap} armed={armed} onArm={setArmed} />
          {allSpacesPlaced && (
            <p className="text-xs text-muted-foreground/70 mt-2">
              All existing spaces are placed — placing another preset creates new spaces automatically.
            </p>
          )}
        </div>
      </div>

      {/* Visitor preview — the map exactly as the public floorplan renders it, at phone width. */}
      {showPreview && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Visitor preview"
        >
          <div
            className="bg-card rounded-2xl shadow-xl p-4 w-[390px] max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">How visitors see it</p>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/70"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <FacilityMapSvg
              className="rounded-xl overflow-hidden border border-border"
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              shapes={shapes.map((s) => ({
                key: s.key,
                spaceId: s.space_id,
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height,
                rotation: s.rotation,
                presetKey: s.presetKey,
                displayName: s.label ?? spaces.find((sp) => sp.id === s.space_id)?.name ?? "",
                groupId: s.groupId,
                laneIndex: s.laneIndex,
              }))}
              contextElements={contexts.map((c) => ({
                key: c.key,
                kind: c.kind,
                x: c.x,
                y: c.y,
                width: c.width,
                height: c.height,
                rotation: c.rotation,
                label: c.label,
              }))}
            />
            <p className="text-xs text-muted-foreground/70 mt-3">
              Live-session highlights appear on the public schedule once sessions are assigned to
              these spaces.
            </p>
          </div>
        </div>
      )}

      {/* Publish guard — unpublished spaces can never show live status publicly. */}
      {publishPrompt && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Publish facility map"
        >
          <div className="bg-card rounded-2xl shadow-xl p-5 max-w-sm w-full">
            <p className="text-sm font-semibold text-foreground">
              {publishPrompt.unpublished.length} space
              {publishPrompt.unpublished.length === 1 ? " isn't" : "s aren't"} published yet
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Unpublished spaces ({publishPrompt.unpublished.map((s) => s.name).join(", ")}) won&apos;t
              show live sessions to visitors, so their shapes on the map would never light up.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <button
                onClick={() => confirmPublish(true)}
                className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Publish spaces and map
              </button>
              <button
                onClick={() => confirmPublish(false)}
                className="px-4 py-2.5 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
              >
                Publish map only
              </button>
              <button
                onClick={() => setPublishPrompt(null)}
                className="px-4 py-2 text-muted-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
