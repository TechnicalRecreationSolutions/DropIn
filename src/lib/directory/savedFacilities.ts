"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Centres a resident has starred on /find, kept in this browser only.
 *
 * Residents have no accounts (a deliberate v1 decision), so this is a
 * per-device convenience and nothing depends on it. Storage can be missing or
 * throw (private windows, blocked site data), in which case the list is
 * simply empty and starring does nothing lasting.
 *
 * useSyncExternalStore rather than state + effect: the server snapshot is the
 * empty list, so the first client render matches the HTML, and a star in
 * another tab arrives through the `storage` event.
 */

const KEY = "dropin:saved-facilities";
const CHANGE_EVENT = "dropin:saved-facilities-change";
const EMPTY: readonly string[] = [];

let cachedRaw: string | null = null;
let cachedIds: readonly string[] = EMPTY;

function read(): readonly string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  // Same string, same array: useSyncExternalStore needs a stable snapshot.
  if (raw === cachedRaw) return cachedIds;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedIds = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : EMPTY;
  } catch {
    cachedIds = EMPTY;
  }
  return cachedIds;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useSavedFacilities() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);

  const toggle = useCallback((id: string) => {
    const current = read();
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { saved, toggle };
}
