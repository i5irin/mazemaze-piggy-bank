import type { DataActivity } from "@/components/dataContext";
import type { CloudProviderId } from "@/lib/storage/types";

export type SyncSignalEntry = {
  key: string;
  activity: DataActivity;
  retryQueueCount: number;
  canWrite: boolean;
  canWriteKnown: boolean;
  lastSyncedAt: string | null;
};

export const buildPersonalSyncSignalKey = (providerId: CloudProviderId): string =>
  `personal:${providerId}`;

export const buildSharedSyncSignalKey = (providerId: CloudProviderId, sharedId: string): string =>
  `shared:${providerId}:${sharedId}`;

const signals = new Map<string, SyncSignalEntry>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const upsertSyncSignal = (entry: SyncSignalEntry) => {
  signals.set(entry.key, entry);
  notify();
};

export const clearSyncSignal = (key: string) => {
  if (signals.delete(key)) {
    notify();
  }
};

export const getSyncSignalsSnapshot = (): Record<string, SyncSignalEntry> =>
  Object.fromEntries(signals.entries());

export const subscribeSyncSignals = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
