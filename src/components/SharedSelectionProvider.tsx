"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useStorageProviderContext } from "@/components/StorageProviderContext";
import type { CloudProviderId } from "@/lib/storage/types";

export type SharedSelection = {
  providerId: CloudProviderId;
  sharedId: string;
  driveId: string;
  itemId: string;
  name: string;
  webUrl?: string;
};

type SharedSelectionContextValue = {
  selection: SharedSelection | null;
  getSelection: (providerId: CloudProviderId) => SharedSelection | null;
  setSelection: (selection: SharedSelection | null) => void;
  setSelectionForProvider: (providerId: CloudProviderId, selection: SharedSelection | null) => void;
  clearSelection: (providerId?: CloudProviderId) => void;
};

const STORAGE_KEY = "mazemaze-piggy-bank-shared-selection";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isProviderId = (value: unknown): value is CloudProviderId =>
  value === "onedrive" || value === "gdrive";

const parseSelection = (raw: unknown): SharedSelection | null => {
  if (!isRecord(raw)) {
    return null;
  }
  if (
    !isProviderId(raw.providerId) ||
    !isString(raw.sharedId) ||
    !isString(raw.driveId) ||
    !isString(raw.itemId) ||
    !isString(raw.name)
  ) {
    return null;
  }
  const webUrl = isString(raw.webUrl) ? raw.webUrl : undefined;
  return {
    providerId: raw.providerId,
    sharedId: raw.sharedId,
    driveId: raw.driveId,
    itemId: raw.itemId,
    name: raw.name,
    webUrl,
  };
};

const parseSelectionMap = (raw: string | null): Record<CloudProviderId, SharedSelection | null> => {
  const empty: Record<CloudProviderId, SharedSelection | null> = {
    onedrive: null,
    gdrive: null,
  };
  if (!raw) {
    return empty;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return empty;
    }
    const onedrive = parseSelection(parsed.onedrive) ?? null;
    const gdrive = parseSelection(parsed.gdrive) ?? null;
    return {
      onedrive,
      gdrive,
    };
  } catch {
    return empty;
  }
};

const SharedSelectionContext = createContext<SharedSelectionContextValue | null>(null);

export function SharedSelectionProvider({ children }: { children: React.ReactNode }) {
  const { activeProviderId } = useStorageProviderContext();
  const [selections, setSelections] = useState<Record<CloudProviderId, SharedSelection | null>>(
    () =>
      typeof window === "undefined"
        ? { onedrive: null, gdrive: null }
        : parseSelectionMap(window.localStorage.getItem(STORAGE_KEY)),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
  }, [selections]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }
      setSelections(parseSelectionMap(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const selection = selections[activeProviderId] ?? null;

  const setSelectionForProvider = useCallback(
    (providerId: CloudProviderId, next: SharedSelection | null) => {
      setSelections((prev) => ({
        ...prev,
        [providerId]: next,
      }));
    },
    [],
  );

  const setSelection = useCallback(
    (next: SharedSelection | null) => {
      if (next) {
        setSelectionForProvider(next.providerId, next);
        return;
      }
      setSelections((prev) => ({
        ...prev,
        [activeProviderId]: null,
      }));
    },
    [activeProviderId, setSelectionForProvider],
  );

  const clearSelection = useCallback(
    (providerId?: CloudProviderId) => {
      const target = providerId ?? activeProviderId;
      setSelections((prev) => ({
        ...prev,
        [target]: null,
      }));
    },
    [activeProviderId],
  );

  const getSelection = useCallback(
    (providerId: CloudProviderId) => selections[providerId] ?? null,
    [selections],
  );

  const value = useMemo(
    () => ({
      selection,
      getSelection,
      setSelection,
      setSelectionForProvider,
      clearSelection,
    }),
    [selection, getSelection, setSelection, setSelectionForProvider, clearSelection],
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
