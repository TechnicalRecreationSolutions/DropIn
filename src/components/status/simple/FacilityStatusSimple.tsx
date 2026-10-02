"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBoard, { type StatusBoardProps } from "./StatusBoard";
import PeopleHere, { type PeopleHereProps } from "./PeopleHere";

/**
 * The Facility status page body: a title row with the one "Post a status"
 * button, then what's wrong, areas, people and temperature — one narrow
 * column, the same on a phone and a laptop.
 */
export default function FacilityStatusSimple({
  facilityName,
  board,
  people,
}: {
  facilityName: string;
  board: Omit<StatusBoardProps, "composer" | "onComposerChange">;
  people: PeopleHereProps;
}) {
  const [composer, setComposer] = useState<{ open: boolean; departmentId: string | null }>({
    open: false,
    departmentId: null,
  });
  const canCompose = board.canWrite || board.canReport;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title text-foreground">Facility status</h1>
          <p className="mt-1 truncate text-body text-muted-foreground">{facilityName}</p>
        </div>
        {canCompose && (
          <Button variant="outline" onClick={() => setComposer({ open: true, departmentId: null })}>
            <Megaphone className="size-4" aria-hidden />
            <span className="hidden sm:inline">{board.canWrite ? "Post a status" : "Report a problem"}</span>
            <span className="sm:hidden">{board.canWrite ? "Post" : "Report"}</span>
          </Button>
        )}
      </div>

      <StatusBoard {...board} composer={composer} onComposerChange={setComposer} />
      <PeopleHere {...people} />

      <p className="text-caption text-muted-foreground">
        Every count, temperature and past status is kept in Analytics.
      </p>
    </div>
  );
}
