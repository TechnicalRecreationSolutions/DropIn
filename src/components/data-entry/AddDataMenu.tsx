"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import ImportDialog from "./ImportDialog";

interface AddDataMenuProps {
  /** Route the "Add manually" item should navigate to (already scoped to the current node). */
  manualHref: string;
  manualLabel?: string;
  facilityId: string;
  facilityName: string;
  departmentId?: string;
  departmentName?: string;
  /**
   * Import creates schedule groups, so it only makes sense at the
   * Facility/Department level — the Schedule Group level only offers manual
   * session entry.
   */
  showImport?: boolean;
}

export default function AddDataMenu({
  manualHref,
  manualLabel = "Add manually",
  facilityId,
  facilityName,
  departmentId,
  departmentName,
  showImport = true,
}: AddDataMenuProps) {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="lg">
            <Plus />
            Add data
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={manualHref}>
              <Plus />
              {manualLabel}
            </Link>
          </DropdownMenuItem>
          {showImport && (
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <Upload />
              Import spreadsheet
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showImport && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          facilityId={facilityId}
          facilityName={facilityName}
          departmentId={departmentId}
          departmentName={departmentName}
        />
      )}
    </>
  );
}
