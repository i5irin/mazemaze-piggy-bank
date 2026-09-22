"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { CloudProviderId } from "@/lib/storage/types";

type StorageProviderContextValue = {
  activeProviderId: CloudProviderId;
  setActiveProviderId: (providerId: CloudProviderId) => void;
};

const STORAGE_KEY = "mazemaze-piggy-bank-storage-provider";
const DEFAULT_PROVIDER: CloudProviderId = "onedrive";
const CHANGED = "mazemaze-storage-provider-changed";
let volatileProvider: CloudProviderId | null = null;

const StorageProviderContext = createContext<StorageProviderContextValue | null>(null);

const isProviderId = (value: string | null): value is CloudProviderId =>
  value === "onedrive" || value === "gdrive";

function readProvider(): CloudProviderId {
  if (volatileProvider) return volatileProvider;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isProviderId(stored) ? stored : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

function setActiveProviderId(providerId: CloudProviderId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, providerId);
    volatileProvider = null;
  } catch {
    // Keep manual selection usable when browser preferences cannot be persisted.
    volatileProvider = providerId;
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      volatileProvider = null;
      notify();
    }
  };
  window.addEventListener(CHANGED, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function StorageProviderContextProvider({ children }: { children: React.ReactNode }) {
  // Hydrate with the server default, then restore browser preferences without overwriting them.
  const activeProviderId = useSyncExternalStore(subscribe, readProvider, () => DEFAULT_PROVIDER);

  const value = useMemo(
    () => ({
      activeProviderId,
      setActiveProviderId,
    }),
    [activeProviderId],
  );

  return (
    <StorageProviderContext.Provider value={value}>{children}</StorageProviderContext.Provider>
  );
}

export const useStorageProviderContext = (): StorageProviderContextValue => {
  const context = useContext(StorageProviderContext);
  if (!context) {
    throw new Error("StorageProviderContext is missing in the component tree.");
  }
  return context;
};
