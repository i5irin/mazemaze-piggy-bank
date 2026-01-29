"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type SharedSelection = {
  sharedId: string;
  driveId: string;
  itemId: string;
  name: string;
  webUrl?: string;
};

type SharedSelectionContextValue = {
  selection: SharedSelection | null;
  setSelection: (selection: SharedSelection | null) => void;
  clearSelection: () => void;
};

const STORAGE_KEY = "piggy-bank-shared-selection";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const parseSelection = (raw: string | null): SharedSelection | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    if (!isString(parsed.sharedId) || !isString(parsed.driveId) || !isString(parsed.itemId)) {
      return null;
    }
    if (!isString(parsed.name)) {
      return null;
    }
    const webUrl = isString(parsed.webUrl) ? parsed.webUrl : undefined;
    return {
      sharedId: parsed.sharedId,
      driveId: parsed.driveId,
      itemId: parsed.itemId,
      name: parsed.name,
      webUrl,
    };
  } catch {
    return null;
  }
};

const SharedSelectionContext = createContext<SharedSelectionContextValue | null>(null);

export function SharedSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelectionState] = useState<SharedSelection | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return parseSelection(window.localStorage.getItem(STORAGE_KEY));
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (selection) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [selection]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }
      setSelectionState(parseSelection(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setSelection = useCallback((next: SharedSelection | null) => {
    setSelectionState(next);
  }, []);

  const clearSelection = useCallback(() => setSelectionState(null), []);

  const value = useMemo(
    () => ({
      selection,
      setSelection,
      clearSelection,
    }),
    [selection, setSelection, clearSelection],
  );

  return (
    <SharedSelectionContext.Provider value={value}>{children}</SharedSelectionContext.Provider>
  );
}

export const useSharedSelection = (): SharedSelectionContextValue => {
  const context = useContext(SharedSelectionContext);
  if (!context) {
    throw new Error("SharedSelectionProvider is missing in the component tree.");
  }
  return context;
};
