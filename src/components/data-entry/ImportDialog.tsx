"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import ImportWizard from "@/components/import/ImportWizard";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  facilityName: string;
  departmentId?: string;
  departmentName?: string;
}

export default function ImportDialog({
  open,
  onOpenChange,
  facilityId,
  facilityName,
  departmentId,
  departmentName,
}: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import spreadsheet</DialogTitle>
          <DialogDescription>
            Importing into: {facilityName}
            {departmentName ? ` › ${departmentName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ImportWizard
          facilities={[{ id: facilityId, name: facilityName }]}
          initialFacilityId={facilityId}
          initialDepartmentId={departmentId}
          departmentName={departmentName}
        />
      </DialogContent>
    </Dialog>
  );
}
