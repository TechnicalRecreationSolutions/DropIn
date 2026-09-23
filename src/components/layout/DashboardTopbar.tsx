"use client";

import Link from "next/link";
import { ClipboardList, Settings, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

const THEME_KEY = "dropin-theme";

/**
 * Flips `.dark` on <html> and persists the choice. Deliberately minimal (no
 * next-themes) — most dashboard pages still hardcode gray/white Tailwind
 * classes instead of the semantic tokens in globals.css, so this only
 * correctly re-themes the chrome and any newly-built cards, not the whole
 * app. See docs/RESUME-layout-rework.md for the full dark-mode rollout.
 */
function useThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const dark = stored ? stored === "dark" : !!prefersDark;
    document.documentElement.classList.toggle("dark", dark);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading an external system (localStorage/matchMedia) that isn't available during SSR
    setIsDark(dark);
  }, []);

  function toggle() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    setIsDark(next);
  }

  return { isDark, toggle };
}

export default function DashboardTopbar() {
  const { isDark, toggle } = useThemeToggle();

  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
      {/* Left: wordmark on mobile. The facility tree sheet opens from the
          bottom bar's Menu tab; a hamburger here used to open the same sheet,
          and two doors into one room read as two different rooms. */}
      <div className="lg:hidden flex items-center">
        <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 font-bold text-sm">Dropin</Link>
      </div>

      <div className="hidden lg:block" />

      {/* Right: icon row + theme toggle. A disabled notifications bell used to
          lead this row; it had no backend (see docs/RESUME-layout-rework.md) and
          a permanently greyed-out control reads as an unfinished product rather
          than a planned one. Restore it here when there is something to notify
          about. Clipboard (activity log) is wired up — see 038_activity_log.sql. */}
      <div className="flex items-center gap-1 sm:gap-3">
        {/* Desktop only: on mobile, Activity is a bottom-bar tab. */}
        <Link href="/dashboard/activity" className="hidden lg:inline-flex">
          <IconButton as="span" title="Activity log">
            <ClipboardList className="size-[18px]" />
          </IconButton>
        </Link>
        <Link href="/dashboard/settings">
          <IconButton as="span" title="Settings">
            <Settings className="size-[18px]" />
          </IconButton>
        </Link>

        <button
          type="button"
          onClick={toggle}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-pressed={isDark}
          className="relative w-11 h-6 rounded-full bg-muted dark:bg-gray-700 transition-colors shrink-0"
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow flex items-center justify-center transition-transform ${
              isDark ? "translate-x-5" : "translate-x-0"
            }`}
          >
            {isDark ? (
              <Moon className="size-3 text-foreground" />
            ) : (
              <Sun className="size-3 text-muted-foreground" />
            )}
          </span>
        </button>
      </div>
    </header>
  );
}

function IconButton({
  children,
  title,
  disabled,
  as: As = "button",
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  as?: "button" | "span";
}) {
  const className =
    "inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:cursor-not-allowed";

  if (As === "span") {
    return (
      <span title={title} className={className}>
        {children}
      </span>
    );
  }

  return (
    <button type="button" title={title} disabled={disabled} className={className}>
      {children}
    </button>
  );
}
