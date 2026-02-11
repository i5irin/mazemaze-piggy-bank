"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CloudProviderId } from "@/lib/storage/types";

type StorageProviderContextValue = {
  activeProviderId: CloudProviderId;
  setActiveProviderId: (providerId: CloudProviderId) => void;
};

const STORAGE_KEY = "mazemaze-piggy-bank-storage-provider";
const DEFAULT_PROVIDER: CloudProviderId = "onedrive";

const StorageProviderContext = createContext<StorageProviderContextValue | null>(null);

const isProviderId = (value: string | null): value is CloudProviderId =>
  value === "onedrive" || value === "gdrive";

export function StorageProviderContextProvider({ children }: { children: React.ReactNode }) {
  const [activeProviderId, setActiveProviderId] = useState<CloudProviderId>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PROVIDER;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isProviderId(stored) ? stored : DEFAULT_PROVIDER;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, activeProviderId);
  }, [activeProviderId]);

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
