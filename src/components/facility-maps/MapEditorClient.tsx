"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import ShapeCanvas, { type EditableShape } from "./ShapeCanvas";
import ShapePalette from "./ShapePalette";
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

/**
 * Facility map authoring UI — drag presets onto a blank canvas, then
 * move/resize/rotate/relabel/assign them, and toggle publish state. Mirrors
 * the rest of the dashboard's authoring convention: local editing state,
 * saved via fetch() to a REST route, then invalidating the relevant query
 * key. The canvas config row is created lazily on first shape placement
 * rather than requiring a separate setup step.
 */
export default function MapEditorClient({ facilityId, spaces }: MapEditorClientProps) {
  const queryClient = useQueryClient();
  const [shapes, setShapes] = useState<EditableShape[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [creatingMap, setCreatingMap] = useState(false);

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

  // Seed local editing state from the loaded shapes — legitimate one-time
  // sync from query result to editable state, same pattern as WidgetConfigurator.
  useEffect(() => {
    if (!existingShapes) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShapes(
      existingShapes.map((s) => ({
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
      }))
    );
    setDirty(false);
  }, [existingShapes]);

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

  async function handlePlacePreset(preset: ShapePreset, dropFraction: { x: number; y: number }) {
    const map = await ensureFacilityMap();
    if (!map) return;

    const assignedSpaceIds = new Set(shapes.map((s) => s.space_id));
    const unassignedSpaces = spaces.filter((s) => !assignedSpaceIds.has(s.id));
    if (unassignedSpaces.length < preset.laneCount) {
      setSaveError(
        preset.laneCount > 1
          ? `"${preset.label}" needs ${preset.laneCount} unassigned spaces (one per lane) — add more spaces first.`
          : "Every space is already placed on the map."
      );
      return;
    }

    const width = Math.min(0.9, preset.widthM / map.canvas_width);
    const height = Math.min(0.9, preset.heightM / map.canvas_height);
    const x = Math.min(1 - width, Math.max(0, dropFraction.x - width / 2));
    const y = Math.min(1 - height, Math.max(0, dropFraction.y - height / 2));

    // A single-lane preset (laneCount 1) is just a group of one — same
    // shape, no groupId/laneIndex, matching every standalone shape today.
    const groupId = preset.laneCount > 1 ? crypto.randomUUID() : null;
    const newShapes: EditableShape[] = Array.from({ length: preset.laneCount }, (_, i) => ({
      key: crypto.randomUUID(),
      space_id: unassignedSpaces[i].id,
      x,
      y,
      width,
      height,
      rotation: 0,
      label: preset.label,
      presetKey: preset.key,
      groupId,
      laneIndex: groupId ? i : null,
    }));

    setSaveError(null);
    setShapes((prev) => [...prev, ...newShapes]);
    setDirty(true);
  }

  async function handleSaveShapes() {
    if (!facilityMap) return;
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/facility-maps/${facilityMap.id}/hotspots`, {
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
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(body.error ?? "Could not save the facility map.");
      return;
    }
    setDirty(false);
    queryClient.invalidateQueries({ queryKey: ["facility-map-hotspots-admin", facilityMap.id] });
    queryClient.invalidateQueries({ queryKey: ["facility-map", facilityId] });
  }

  async function handleTogglePublish() {
    if (!facilityMap) return;
    setSaveError(null);
    const res = await fetch(`/api/facility-maps/${facilityMap.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: !facilityMap.is_published }),
    });
    if (!res.ok) {
      setSaveError("Could not update publish state.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["facility-map-admin", facilityId] });
    queryClient.invalidateQueries({ queryKey: ["facility-map", facilityId] });
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading…</div>;
  }

  if (spaces.length === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
        <p className="text-sm text-gray-500">Add spaces to this facility first, then come back to place them on the map.</p>
      </div>
    );
  }

  const canvasWidth = facilityMap?.canvas_width ?? 25;
  const canvasHeight = facilityMap?.canvas_height ?? 15;
  const assignedSpaceIds = new Set(shapes.map((s) => s.space_id));
  const allSpacesPlaced = spaces.every((s) => assignedSpaceIds.has(s.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">
          Drag a preset onto the canvas for each space, then publish to show the floorplan layout
          to visitors.
        </p>
        {facilityMap && (
          <button
            onClick={handleTogglePublish}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${
              facilityMap.is_published
                ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
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

      <ShapeCanvas
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        shapes={shapes}
        spaces={spaces}
        onChange={(next) => {
          setShapes(next);
          setDirty(true);
        }}
      />

      <ShapePalette disabled={allSpacesPlaced || creatingMap} onPlace={handlePlacePreset} />

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      <button
        onClick={handleSaveShapes}
        disabled={!dirty || saving || !facilityMap}
        className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? "Saving…" : "Save map"}
      </button>
    </div>
  );
}
