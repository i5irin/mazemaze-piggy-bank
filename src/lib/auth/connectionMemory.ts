"use client";

import { useSyncExternalStore } from "react";
import type { CloudProviderId } from "@/lib/storage/types";

export const CONNECTION_MEMORY_KEY = "mazemaze-piggy-bank-connected-providers-v1";
const CHANGED = "mazemaze-connection-memory-changed";
type Memory = Record<CloudProviderId, boolean>;

function read(): string | null {
  try {
    return window.localStorage.getItem(CONNECTION_MEMORY_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Memory {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value === "object" && value !== null) {
      return {
        onedrive: "onedrive" in value && value.onedrive === true,
        gdrive: "gdrive" in value && value.gdrive === true,
      };
    }
  } catch {
    // Invalid or unavailable preferences must not prevent sign-in.
  }
  return { onedrive: false, gdrive: false };
}

export function rememberConnection(provider: CloudProviderId, connected: boolean) {
  try {
    const memory = parse(read());
    if (memory[provider] === connected) return;
    memory[provider] = connected;
    window.localStorage.setItem(CONNECTION_MEMORY_KEY, JSON.stringify(memory));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    // The preference is optional; never persist credentials as a fallback.
  }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONNECTION_MEMORY_KEY) notify();
  };
  window.addEventListener(CHANGED, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function useConnectionMemory(): Memory {
  return parse(useSyncExternalStore(subscribe, read, () => null));
}
