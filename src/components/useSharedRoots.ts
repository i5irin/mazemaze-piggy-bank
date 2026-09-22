"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { JOINED_ROOTS_CHANGED, JOINED_ROOTS_PREFIX } from "@/lib/onedrive/joinedRoots";
import type { StorageService } from "@/lib/storage/storageService";
import type { SharedRootListItem } from "@/lib/storage/types";

export function useSharedRoots(storage: StorageService, identity: string | null, enabled: boolean) {
  const sequence = useRef(0);
  const invalidate = useCallback(() => {
    sequence.current++;
  }, []);
  const [state, setState] = useState<{
    identity: string | null;
    roots: SharedRootListItem[];
    status: "idle" | "loading" | "ready" | "error";
    message: string | null;
  }>({ identity: null, roots: [], status: "idle", message: null });

  const refresh = useCallback(async (): Promise<SharedRootListItem[]> => {
    const request = ++sequence.current;
    if (!enabled || !identity || !storage.capabilities.supportsShared) return [];
    setState({ identity, roots: [], status: "loading", message: "Loading shared workspaces..." });
    const results = await Promise.allSettled([
      storage.listSharedWithMeRoots(),
      storage.listSharedByMeRoots(),
    ]);
    if (request !== sequence.current) return [];
    const byId = new Map<string, SharedRootListItem>();
    for (const result of results) {
      if (result.status === "fulfilled")
        for (const root of result.value) byId.set(root.sharedId, root);
    }
    const roots = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    const failed = results.some((result) => result.status === "rejected");
    setState({
      identity,
      roots,
      status: failed ? "error" : "ready",
      message: failed
        ? "Some workspaces could not be loaded. Check your connection and account, then refresh the list."
        : null,
    });
    return roots;
  }, [enabled, identity, storage]);

  useEffect(() => {
    const reload = () => {
      void refresh();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(JOINED_ROOTS_PREFIX)) reload();
    };
    const timer = window.setTimeout(reload, 0);
    window.addEventListener(JOINED_ROOTS_CHANGED, reload);
    window.addEventListener("storage", storageChanged);
    return () => {
      invalidate();
      window.clearTimeout(timer);
      window.removeEventListener(JOINED_ROOTS_CHANGED, reload);
      window.removeEventListener("storage", storageChanged);
    };
  }, [refresh, invalidate]);

  const visible = enabled && identity && state.identity === identity;
  return {
    roots: visible ? state.roots : [],
    status: visible ? state.status : ("idle" as const),
    message: visible ? state.message : null,
    refresh,
  };
}
