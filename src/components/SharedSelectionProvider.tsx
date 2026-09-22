"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
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

const parseSelectionMap = (raw: string | null): Record<string, SharedSelection | null> => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const selections: Record<string, SharedSelection | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const selection = parseSelection(value);
      // Old OneDrive selections have no account identity and cannot be safely adopted.
      if (
        (key === "gdrive" && selection?.providerId === "gdrive") ||
        (key.startsWith("onedrive:") && selection?.providerId === "onedrive")
      )
        selections[key] = selection;
    }
    return selections;
  } catch {
    return {};
  }
};

const SharedSelectionContext = createContext<SharedSelectionContextValue | null>(null);

export function SharedSelectionProvider({ children }: { children: React.ReactNode }) {
  const { activeProviderId } = useStorageProviderContext();
  const { providers } = useAuth();
  const microsoftId =
    providers.onedrive.status === "signed_in" ? providers.onedrive.account?.id : undefined;
  const selectionKey = useCallback(
    (providerId: CloudProviderId) =>
      providerId === "gdrive" ? "gdrive" : microsoftId ? `onedrive:${microsoftId}` : null,
    [microsoftId],
  );
  const [selections, setSelections] = useState<Record<string, SharedSelection | null>>(() =>
    typeof window === "undefined"
      ? {}
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

  const activeKey = selectionKey(activeProviderId);
  const selection = activeKey ? (selections[activeKey] ?? null) : null;

  const setSelectionForProvider = useCallback(
    (providerId: CloudProviderId, next: SharedSelection | null) => {
      const key = selectionKey(providerId);
      if (!key || (next && next.providerId !== providerId)) return;
      setSelections((prev) => ({ ...prev, [key]: next }));
    },
    [selectionKey],
  );

  const setSelection = useCallback(
    (next: SharedSelection | null) => {
      if (next) {
        setSelectionForProvider(next.providerId, next);
        return;
      }
      setSelectionForProvider(activeProviderId, null);
    },
    [activeProviderId, setSelectionForProvider],
  );

  const clearSelection = useCallback(
    (providerId?: CloudProviderId) => {
      const target = providerId ?? activeProviderId;
      setSelectionForProvider(target, null);
    },
    [activeProviderId, setSelectionForProvider],
  );

  const getSelection = useCallback(
    (providerId: CloudProviderId) => {
      const key = selectionKey(providerId);
      return key ? (selections[key] ?? null) : null;
    },
    [selections, selectionKey],
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
