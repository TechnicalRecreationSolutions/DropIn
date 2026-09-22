"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

export type DepartmentSection = "details" | "hours" | "holidays";

/**
 * Lets a section's editor tell the shell around it that it is holding unsaved
 * edits.
 *
 * The department edit page's three editors each own their own Save button —
 * they write to three different endpoints, and one combined save would
 * half-fail — so the only thing that can join them up is a shared "this
 * section is dirty" signal. The shell uses it for the dot on the tab and the
 * leave-the-page warning, which closes the old page's central trap: typing a
 * week of hours, moving on, and never pressing the one Save button that was
 * below the fold.
 *
 * Its own file rather than the shell's so that the "add a department" pages,
 * which render the same form with no shell around it, do not pull the whole
 * editor frame into their bundle.
 */
const DirtyContext = createContext<((section: DepartmentSection, dirty: boolean) => void) | null>(
  null
);

export function SectionDirtyProvider({
  report,
  children,
}: {
  report: (section: DepartmentSection, dirty: boolean) => void;
  children: ReactNode;
}) {
  return <DirtyContext.Provider value={report}>{children}</DirtyContext.Provider>;
}

/** Called by each editor with its own dirty state. A no-op outside the shell,
 *  so every editor stays usable on its own. */
export function useSectionDirty(section: DepartmentSection, dirty: boolean) {
  const report = useContext(DirtyContext);

  useEffect(() => {
    report?.(section, dirty);
  }, [report, section, dirty]);

  // Clears the flag if the section ever unmounts while dirty, so a stale dot
  // cannot outlive the editor that set it.
  useEffect(() => () => report?.(section, false), [report, section]);
}
