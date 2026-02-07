export type SyncIndicatorState = "online" | "saving" | "retry_needed" | "offline" | "view_only";

export type SyncDotTone = "green" | "yellow" | "red";

type SyncIndicatorMeta = {
  label: string;
  tone: SyncDotTone;
};

const SYNC_INDICATOR_META: Record<SyncIndicatorState, SyncIndicatorMeta> = {
  online: { label: "Online", tone: "green" },
  saving: { label: "Saving…", tone: "yellow" },
  retry_needed: { label: "Retry needed", tone: "red" },
  offline: { label: "Offline", tone: "red" },
  view_only: { label: "View-only", tone: "yellow" },
};

export const getSyncIndicatorMeta = (state: SyncIndicatorState): SyncIndicatorMeta =>
  SYNC_INDICATOR_META[state];

export const resolveSyncIndicatorState = (input: {
  isOnline: boolean;
  isSaving: boolean;
  retryQueueCount: number;
  isViewOnly: boolean;
}): SyncIndicatorState => {
  if (!input.isOnline) {
    return "offline";
  }
  if (input.isSaving) {
    return "saving";
  }
  if (input.retryQueueCount > 0) {
    return "retry_needed";
  }
  if (input.isViewOnly) {
    return "view_only";
  }
  return "online";
};
