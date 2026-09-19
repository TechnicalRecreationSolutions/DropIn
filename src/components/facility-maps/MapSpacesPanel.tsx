"use client";

import Link from "next/link";
import { CheckCircle2, Circle, DoorOpen, EyeOff, Layers, MapPin, Plus, Trash2 } from "lucide-react";
import { buildSpaceSections } from "@/lib/spaces/grouping";
import { cn } from "@/lib/utils/cn";
import { spacesHref } from "@/lib/schedule/commandCentreHref";
import { unitKeyOf, type EditableShape, type EditableContextElement } from "./ShapeCanvas";

export interface MapSpace {
  id: string;
  name: string;
  isPublished: boolean;
  departmentId: string | null;
  zoneName: string | null;
}

interface MapSpacesPanelProps {
  facilityId: string;
  spaces: MapSpace[];
  /** This building's departments, in display order. */
  departments: { id: string; name: string }[];
  shapes: EditableShape[];
  contextElements: EditableContextElement[];
  selectedKey: string | null;
  onSelect: (unitKey: string | null) => void;
  /** "Place" on an unplaced space — the editor switches to the shape picker for it. */
  onPlaceSpace: (spaceId: string) => void;
  /** The space currently waiting for a shape, if any. */
  placingSpaceId: string | null;
  onChange: (shapes: EditableShape[], contextElements: EditableContextElement[]) => void;
  onCommit: () => void;
}

/**
 * The map editor's "Spaces" tab — the Spaces page, seen from the map.
 *
 * Grouped by department then zone through the same `buildSpaceSections` the
 * Spaces page uses, so a space sits in the same place on both screens. Each
 * space says whether it is on the map; placed ones select their shape on the
 * canvas, unplaced ones offer "Place". This replaced a flat list of every
 * placed shape with a space dropdown on each row, which never said what was
 * *missing* from the map and ignored the department/zone structure entirely.
 *
 * The selected shape's settings (which space, label, remove) sit at the top
 * so editing never needs a scroll back to find the thing you clicked.
 * Spaces themselves — names, departments, zones, order — are still edited on
 * the Spaces page; the links here go there.
 */
export default function MapSpacesPanel({
  facilityId,
  spaces,
  departments,
  shapes,
  contextElements,
  selectedKey,
  onSelect,
  onPlaceSpace,
  placingSpaceId,
  onChange,
  onCommit,
}: MapSpacesPanelProps) {
  const shapeBySpaceId = new Map(shapes.map((s) => [s.space_id, s]));
  const sections = buildSpaceSections(spaces, departments);
  const placedCount = spaces.filter((s) => shapeBySpaceId.has(s.id)).length;

  return (
    <div className="space-y-4">
      <SelectionEditor
        spaces={spaces}
        departments={departments}
        shapes={shapes}
        contextElements={contextElements}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onChange={onChange}
        onCommit={onCommit}
      />

      {spaces.length === 0 ? (
        <div className="text-center py-8 px-3 rounded-xl border border-dashed border-border">
          <MapPin className="w-6 h-6 text-muted-foreground/70 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No spaces in this building yet. Placing a shape creates them, or add them on the Spaces
            page first.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{placedCount}</span> of {spaces.length}{" "}
            space{spaces.length !== 1 ? "s" : ""} on the map
          </p>

          {sections.map((section) => {
            const sectionPlaced = section.zones.reduce(
              (n, z) => n + z.spaces.filter((s) => shapeBySpaceId.has(s.id)).length,
              0
            );
            return (
              <section key={section.departmentId ?? "none"}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                  <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide truncate">
                    {section.label}
                  </h3>
                  <span className="ml-auto text-[11px] text-muted-foreground/70 shrink-0 tabular-nums">
                    {sectionPlaced}/{section.total}
                  </span>
                </div>

                <div className="space-y-2">
                  {section.zones.map((zone) => (
                    <div key={zone.zoneName ?? "__none"}>
                      {zone.zoneName && (
                        <p className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground mb-1">
                          <span className="truncate">{zone.zoneName}</span>
                          <span className="h-px flex-1 bg-border" aria-hidden="true" />
                        </p>
                      )}
                      <ul className="space-y-1">
                        {zone.spaces.map((space) => {
                          const shape = shapeBySpaceId.get(space.id);
                          return (
                            <li key={space.id}>
                              <SpaceRow
                                space={space}
                                placed={!!shape}
                                selected={!!shape && unitKeyOf(shape) === selectedKey}
                                placing={placingSpaceId === space.id}
                                onSelect={() => shape && onSelect(unitKeyOf(shape))}
                                onPlace={() => onPlaceSpace(space.id)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {contextElements.length > 0 && (
        <section>
          <div className="flex items-center gap-1.5 mb-1.5">
            <DoorOpen className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Map labels
            </h3>
          </div>
          <ul className="space-y-1">
            {contextElements.map((ctx) => (
              <li key={ctx.key}>
                <button
                  type="button"
                  onClick={() => onSelect(ctx.key)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-sm transition-colors",
                    ctx.key === selectedKey
                      ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40"
                      : "border-transparent hover:bg-muted"
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 w-14 shrink-0">
                    {ctx.kind === "entrance" ? "Entrance" : "Zone"}
                  </span>
                  <span className="truncate text-foreground">
                    {ctx.label ?? (ctx.kind === "entrance" ? "Entrance" : "Unnamed zone")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href={spacesHref(facilityId)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Plus className="w-3.5 h-3.5" />
        Add, rename, or regroup spaces on the Spaces page
      </Link>
    </div>
  );
}

function SpaceRow({
  space,
  placed,
  selected,
  placing,
  onSelect,
  onPlace,
}: {
  space: MapSpace;
  placed: boolean;
  selected: boolean;
  placing: boolean;
  onSelect: () => void;
  onPlace: () => void;
}) {
  const draft = !space.isPublished && (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 shrink-0"
      title="Draft — visitors won't see live status here until the space is published"
    >
      <EyeOff className="w-3 h-3" />
      Draft
    </span>
  );

  if (placed) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-sm transition-colors",
          selected
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40"
            : "border-transparent hover:bg-muted"
        )}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" aria-hidden="true" />
        <span className="truncate text-foreground">{space.name}</span>
        <span className="sr-only">— on the map</span>
        <span className="ml-auto flex items-center gap-2">{draft}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed text-sm",
        placing ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40" : "border-border"
      )}
    >
      <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" aria-hidden="true" />
      <span className="truncate text-muted-foreground">{space.name}</span>
      <span className="sr-only">— not on the map</span>
      <span className="ml-auto flex items-center gap-2">
        {draft}
        <button
          type="button"
          onClick={onPlace}
          className="px-2 py-0.5 rounded-md text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          {placing ? "Pick a shape…" : "Place"}
        </button>
      </span>
    </div>
  );
}

/**
 * Settings for whatever is selected on the canvas — the shape's space, its
 * label override, and remove. A pool edits each lane's space in one card.
 */
function SelectionEditor({
  spaces,
  departments,
  shapes,
  contextElements,
  selectedKey,
  onSelect,
  onChange,
  onCommit,
}: {
  spaces: MapSpace[];
  departments: { id: string; name: string }[];
  shapes: EditableShape[];
  contextElements: EditableContextElement[];
  selectedKey: string | null;
  onSelect: (unitKey: string | null) => void;
  onChange: (shapes: EditableShape[], contextElements: EditableContextElement[]) => void;
  onCommit: () => void;
}) {
  if (!selectedKey) return null;

  const context = contextElements.find((c) => c.key === selectedKey);
  if (context) {
    return (
      <Card
        title={context.kind === "entrance" ? "Entrance" : "Zone label"}
        onRemove={() => {
          onChange(shapes, contextElements.filter((c) => c.key !== context.key));
          onSelect(null);
          onCommit();
        }}
      >
        <input
          type="text"
          value={context.label ?? ""}
          onChange={(e) =>
            onChange(
              shapes,
              contextElements.map((c) =>
                c.key === context.key ? { ...c, label: e.target.value || null } : c
              )
            )
          }
          onBlur={onCommit}
          placeholder={context.kind === "entrance" ? "Entrance" : "e.g. Lobby, Change Rooms"}
          aria-label="Label"
          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Card>
    );
  }

  const members = shapes
    .filter((s) => unitKeyOf(s) === selectedKey)
    .sort((a, b) => (a.laneIndex ?? 0) - (b.laneIndex ?? 0));
  if (members.length === 0) return null;

  const assigned = new Set(shapes.map((s) => s.space_id));
  const sections = buildSpaceSections(spaces, departments);
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? "Unassigned";

  const updateShape = (key: string, patch: Partial<EditableShape>) =>
    onChange(
      shapes.map((s) => (s.key === key ? { ...s, ...patch } : s)),
      contextElements
    );

  const isGroup = members[0].groupId !== null;

  return (
    <Card
      title={isGroup ? `Pool · ${members.length} lanes` : spaceName(members[0].space_id)}
      onRemove={() => {
        const keys = new Set(members.map((m) => m.key));
        onChange(shapes.filter((s) => !keys.has(s.key)), contextElements);
        onSelect(null);
        onCommit();
      }}
    >
      <div className="space-y-2">
        {members.map((member, i) => (
          <div key={member.key} className="space-y-1.5">
            {isGroup && (
              <p className="text-[11px] font-medium text-muted-foreground">Lane {i + 1}</p>
            )}
            <label className="block">
              <span className="sr-only">Space</span>
              <select
                value={member.space_id}
                onChange={(e) => {
                  updateShape(member.key, { space_id: e.target.value });
                  onCommit();
                }}
                className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sections.map((section) => (
                  <optgroup key={section.departmentId ?? "none"} label={section.label}>
                    {section.zones.flatMap((zone) =>
                      zone.spaces.map((s) => (
                        <option
                          key={s.id}
                          value={s.id}
                          disabled={s.id !== member.space_id && assigned.has(s.id)}
                        >
                          {zone.zoneName ? `${zone.zoneName} › ${s.name}` : s.name}
                        </option>
                      ))
                    )}
                  </optgroup>
                ))}
              </select>
            </label>
            <input
              type="text"
              value={member.label ?? ""}
              onChange={(e) => updateShape(member.key, { label: e.target.value || null })}
              onBlur={onCommit}
              placeholder={`Map label (default: ${spaceName(member.space_id)})`}
              aria-label="Map label override"
              className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Card({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide truncate">
          Selected · {title}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto p-1 rounded-lg text-muted-foreground/70 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          aria-label={`Remove ${title} from the map`}
          title="Remove from the map"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  );
}
