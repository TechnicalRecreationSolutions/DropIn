"use client";

import { Building2, Layers } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DepartmentOption, FacilityOption } from "./types";
import type { InvitableRole } from "@/types/app.types";
import { InfoTip } from "@/components/ui/info-tip";

interface ScopePickerProps {
  role: InvitableRole;
  facilities: FacilityOption[];
  departments: DepartmentOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * What a coordinator or aux staffer can reach.
 *
 * The two roles are scoped at different grains and the picker changes shape to
 * match: departments for a coordinator, facilities for aux staff. That is not
 * cosmetic — a membership carrying the wrong grain has scope rows that can
 * never match anything its role consults, which reads as "access granted" and
 * behaves as "access denied".
 *
 * Departments are **grouped by building and listed with it**, because they are
 * per-facility rows: "Aquatics" at Commonwealth Pool and "Aquatics" at
 * Panorama are two different departments with the same name, and a bare list
 * would show two identical checkboxes. A coordinator running aquatics across
 * three pools ticks three boxes, which is the model working, not a UI failure.
 *
 * Managers are org-wide and never see this.
 */
export default function ScopePicker({
  role,
  facilities,
  departments,
  selected,
  onChange,
}: ScopePickerProps) {
  if (role === "manager") {
    return (
      <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2.5">
        Managers can see and change everything in your organization, in every building.
      </p>
    );
  }

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  if (role === "aux") {
    return (
      <Options
        label="Which buildings should they see?"
        hint="They will see the internal schedule for these buildings, and nothing else."
        empty="Add a facility first — staff are given access to a building."
        items={facilities.map((f) => ({ id: f.id, name: f.name, icon: Building2 }))}
        selected={selected}
        onToggle={toggle}
      />
    );
  }

  const byFacility = facilities
    .map((f) => ({ facility: f, rows: departments.filter((d) => d.facility_id === f.id) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-foreground">Which departments do they run?</p>
        <InfoTip>
          Full control of the schedules in these departments, and no access to any others.
        </InfoTip>
      </div>

      {byFacility.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2.5">
          There are no departments yet. Create one before adding a coordinator.
        </p>
      ) : (
        <div className="space-y-3">
          {byFacility.map(({ facility, rows }) => (
            <div key={facility.id}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 pb-1">
                {facility.name}
              </p>
              <div className="space-y-1">
                {rows.map((d) => (
                  <Option
                    key={d.id}
                    id={d.id}
                    name={d.name}
                    icon={Layers}
                    checked={selected.includes(d.id)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Options({
  label,
  hint,
  empty,
  items,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  empty: string;
  items: { id: string; name: string; icon: typeof Building2 }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <InfoTip>{hint}</InfoTip>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2.5">
          {empty}
        </p>
      ) : (
        <div className="space-y-1">
          {items.map((i) => (
            <Option
              key={i.id}
              id={i.id}
              name={i.name}
              icon={i.icon}
              checked={selected.includes(i.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({
  id,
  name,
  icon: Icon,
  checked,
  onToggle,
}: {
  id: string;
  name: string;
  icon: typeof Building2;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      className={cn(
        // min-h-11 keeps every row a comfortable tap target on a phone, which
        // is where a supervisor actually adds a lifeguard.
        "flex items-center gap-3 min-h-11 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
        checked
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(id)}
        className="size-4 accent-primary"
      />
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-foreground">{name}</span>
    </label>
  );
}
