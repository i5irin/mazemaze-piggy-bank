"use client";

import { Button, Radio, RadioGroup, Spinner, Text } from "@fluentui/react-components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { type ThemePreference, useTheme } from "@/components/AppProviders";
import { usePersonalData } from "@/components/PersonalDataProvider";
import { useSharedSelection } from "@/components/SharedSelectionProvider";
import { isAuthError } from "@/lib/auth/authErrors";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGraphClient } from "@/lib/graph/graphClient";
import { isGraphError } from "@/lib/graph/graphErrors";
import {
  DEFAULT_TEST_FILE_NAME,
  createOneDriveService,
  type ShareLinkPermission,
  type SharedRootListItem,
  type SharedRootReference,
} from "@/lib/onedrive/oneDriveService";
import { clearSnapshotCache } from "@/lib/persistence/snapshotCache";
import { getSyncIndicatorMeta, resolveSyncIndicatorState } from "@/lib/persistence/syncStatus";
import { useNow } from "@/lib/time/useNow";

type OperationState = {
  status: "idle" | "working" | "success" | "error";
  message: string | null;
  payload?: unknown;
};

type SharedRootsState = {
  status: "idle" | "loading" | "ready" | "error";
  message: string | null;
};

type SettingsSectionId =
  | "provider-sign-in"
  | "connection-health"
  | "shared"
  | "appearance"
  | "advanced-diagnostics"
  | "danger-zone";

const sensitiveKeys = [
  "authorization",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "password",
  "secret",
  "token",
];
const emailKeys = ["email", "userPrincipalName", "upn"];
const idKeys = ["id", "driveId", "itemId", "siteId", "tenantId", "userId"];

const maskId = (value: string): string => {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const maskEmail = (value: string): string => {
  const atIndex = value.indexOf("@");
  if (atIndex <= 1) {
    return "***";
  }
  return `${value.slice(0, 1)}***${value.slice(atIndex)}`;
};

const looksLikeJwt = (value: string): boolean => {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length >= 10);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const maskSensitiveData = (value: unknown, parentKey?: string): unknown => {
  if (typeof value === "string") {
    const key = parentKey?.toLowerCase() ?? "";
    if (sensitiveKeys.some((entry) => key.includes(entry.toLowerCase()))) {
      return "[REDACTED]";
    }
    if (emailKeys.some((entry) => key.includes(entry.toLowerCase()))) {
      return maskEmail(value);
    }
    if (idKeys.some((entry) => key === entry.toLowerCase())) {
      return maskId(value);
    }
    if (looksLikeJwt(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveData(item, parentKey));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, maskSensitiveData(entry, key)]),
    );
  }
  return value;
};

const formatPayload = (payload: unknown): string =>
  JSON.stringify(maskSensitiveData(payload), null, 2);

const getUserMessage = (error: unknown): string => {
  if (isAuthError(error)) {
    if (error.code === "missing-config") {
      return "Microsoft sign-in is not configured. Check your .env.local values.";
    }
    if (error.code === "not-signed-in") {
      return "You are not signed in. Please sign in first.";
    }
    return "Microsoft sign-in failed. Please try again.";
  }
  if (isGraphError(error)) {
    if (error.code === "unauthorized") {
      return "Authentication failed. Please sign in again.";
    }
    if (error.code === "forbidden") {
      return "Permission denied. Please consent to the required Graph scopes.";
    }
    if (error.code === "not_found") {
      return "The file or folder was not found.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Please wait and try again.";
    }
    if (error.code === "precondition_failed") {
      return "The data changed on OneDrive. Please reload and try again.";
    }
    if (error.code === "network_error") {
      return "Network error. Check your connection and try again.";
    }
    return "Microsoft Graph request failed. Please try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
};

const getSaveErrorMessage = (reason: string, fallback?: string): string => {
  if (reason === "offline") {
    return "Offline mode is view-only. Reconnect and try again.";
  }
  if (reason === "unauthenticated") {
    return "Sign in to continue.";
  }
  if (reason === "read_only") {
    return "This space is read-only.";
  }
  if (reason === "missing_etag") {
    return "Missing server version. Reload and try again.";
  }
  if (reason === "partial_failure") {
    return fallback ?? "Retry is required to finish syncing queued changes.";
  }
  if (reason === "conflict") {
    return "Data changed elsewhere. Reloaded latest data.";
  }
  return fallback ?? "Could not complete the operation.";
};

const buildExportTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  "provider-sign-in",
  "connection-health",
  "shared",
  "appearance",
  "advanced-diagnostics",
  "danger-zone",
];

const SETTINGS_SECTION_TITLES: Record<SettingsSectionId, string> = {
  "provider-sign-in": "Provider & sign-in",
  "connection-health": "Connection health",
  shared: "Shared",
  appearance: "Appearance",
  "advanced-diagnostics": "Advanced / Diagnostics",
  "danger-zone": "Danger zone",
};

const isSettingsSectionId = (value: string): value is SettingsSectionId =>
  SETTINGS_SECTION_IDS.includes(value as SettingsSectionId);

const resolveHashSection = (hash: string): SettingsSectionId | null => {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) {
    return null;
  }
  return isSettingsSectionId(raw) ? raw : null;
};

const formatThemePreference = (preference: ThemePreference): string => {
  if (preference === "light") {
    return "Light";
  }
  if (preference === "dark") {
    return "Dark";
  }
  return "System";
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
};

const copyToClipboard = async (value: string): Promise<boolean> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

const formatAbsoluteTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US", { hour12: false });
};

const formatRelativeTimestamp = (value: string, now: number): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  const diffMs = parsed.getTime() - now;
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMinutes < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return formatter.format(diffDays, "day");
  }

  return parsed.toLocaleDateString("en-US");
};

const mergeSharedRoots = (items: SharedRootListItem[]): SharedRootListItem[] => {
  const byId = new Map<string, SharedRootListItem>();
  for (const item of items) {
    byId.set(item.sharedId, item);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
};

export function SettingsClient() {
  const { status, account, error, signIn, signOut, getAccessToken } = useAuth();
  const { preference, setPreference, mode } = useTheme();
  const data = usePersonalData();
  const { selection, setSelection, clearSelection } = useSharedSelection();
  const now = useNow(60_000);
  const [isMounted] = useState(() => typeof window !== "undefined");
  const [isSelectionHydrated, setIsSelectionHydrated] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId | null>(null);
  const [overlayOrigin, setOverlayOrigin] = useState<"list" | "hash" | null>(null);
  const suppressNextHashOrigin = useRef(false);

  const [driveState, setDriveState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [exportState, setExportState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [syncState, setSyncState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [sharedState, setSharedState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [shareLinkState, setShareLinkState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [shareLinkUrl, setShareLinkUrl] = useState("");
  const [shareLinkPermission, setShareLinkPermission] = useState<ShareLinkPermission>("view");
  const [dangerState, setDangerState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [sharedRoots, setSharedRoots] = useState<SharedRootListItem[]>([]);
  const [sharedRootsState, setSharedRootsState] = useState<SharedRootsState>({
    status: "idle",
    message: null,
  });
  const [sharedAccess, setSharedAccess] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null,
  });

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [copyPathMessage, setCopyPathMessage] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteAcknowledge, setDeleteAcknowledge] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const graphScopes = useMemo(() => getGraphScopes(), []);
  const tokenProvider = useCallback((scopes: string[]) => getAccessToken(scopes), [getAccessToken]);

  const graphClient = useMemo(
    () =>
      createGraphClient({
        accessTokenProvider: tokenProvider,
        onRetry: (info) => {
          setDriveState((prev) =>
            prev.status === "working"
              ? {
                  ...prev,
                  message: `Rate limited. Retrying in ${Math.ceil(
                    info.delayMs / 1000,
                  )}s (attempt ${info.attempt}/3).`,
                }
              : prev,
          );
        },
      }),
    [tokenProvider],
  );

  const oneDrive = useMemo(
    () => createOneDriveService(graphClient, graphScopes),
    [graphClient, graphScopes],
  );

  const appRootLabel = process.env.NEXT_PUBLIC_ONEDRIVE_APP_ROOT ?? "/Apps/MazemazePiggyBank/";
  const effectiveSelection = isSelectionHydrated ? selection : null;
  const sharedRoot = useMemo<SharedRootReference | null>(() => {
    if (!effectiveSelection) {
      return null;
    }
    return {
      sharedId: effectiveSelection.sharedId,
      driveId: effectiveSelection.driveId,
      itemId: effectiveSelection.itemId,
    };
  }, [effectiveSelection]);

  const signInStatus =
    status === "loading"
      ? "Checking sign-in status..."
      : status === "signed_in"
        ? `Signed in as ${account?.name ?? account?.username ?? "Unknown"}`
        : status === "error"
          ? "Sign-in configuration error"
          : "Not connected";

  const isSignedIn = status === "signed_in";
  const isDriveWorking = driveState.status === "working";
  const isExportWorking = exportState.status === "working";
  const isSyncWorking = syncState.status === "working";
  const isSharedWorking = sharedState.status === "working";
  const isShareLinkWorking = shareLinkState.status === "working";
  const isDangerWorking = dangerState.status === "working";
  const isAuthLoading = status === "loading";
  const isAuthBlocked = status === "error";

  const currentSyncState = resolveSyncIndicatorState({
    isOnline: data.isOnline,
    isSaving: data.activity === "saving",
    retryQueueCount: data.retryQueueCount,
    isViewOnly: !data.canWrite,
  });
  const currentSyncMeta = getSyncIndicatorMeta(currentSyncState);
  const lastSyncRelative = data.snapshot?.updatedAt
    ? formatRelativeTimestamp(data.snapshot.updatedAt, now)
    : "Never";
  const lastSyncAbsolute = data.snapshot?.updatedAt
    ? formatAbsoluteTimestamp(data.snapshot.updatedAt)
    : null;

  const accountLabel = account?.name ?? account?.username ?? "Unknown";
  const providerSummary = isSignedIn ? `Signed in as ${accountLabel}` : "Not signed in";

  const selectedSharedId = effectiveSelection?.sharedId ?? "";
  const selectedSharedRoot = sharedRoots.find((root) => root.sharedId === selectedSharedId) ?? null;
  const selectedSharedWebUrl = effectiveSelection?.webUrl ?? selectedSharedRoot?.webUrl ?? null;
  const retryNowDisabled =
    isSyncWorking || !isSignedIn || !data.isOnline || !data.canWrite || data.retryQueueCount <= 0;
  const retryNowDisabledReason = useMemo(() => {
    if (isSyncWorking) {
      return "Sync is already running.";
    }
    if (!isSignedIn) {
      return "Sign in to retry.";
    }
    if (!data.isOnline) {
      return "You're offline.";
    }
    if (!data.canWrite) {
      return "Read-only mode.";
    }
    if (data.retryQueueCount <= 0) {
      return "No queued retries.";
    }
    return null;
  }, [data.canWrite, data.isOnline, data.retryQueueCount, isSignedIn, isSyncWorking]);
  const shareLinkDisabledReason = useMemo(() => {
    if (!isSignedIn) {
      return "Sign in to create share links.";
    }
    if (!data.isOnline) {
      return "Reconnect to create share links.";
    }
    if (!sharedRoot) {
      return "Select a shared folder first.";
    }
    if (isSharedWorking) {
      return "Wait for shared folder updates to finish.";
    }
    if (isShareLinkWorking) {
      return "Creating share link...";
    }
    return null;
  }, [data.isOnline, isShareLinkWorking, isSharedWorking, isSignedIn, sharedRoot]);
  const isShareLinkDisabled = Boolean(shareLinkDisabledReason);

  const connectionSummary = useMemo(() => {
    if (currentSyncState === "retry_needed") {
      return `Retry needed - ${data.retryQueueCount} queued`;
    }
    if (currentSyncState === "offline") {
      return "Offline";
    }
    if (currentSyncState === "view_only") {
      return "View-only";
    }
    if (currentSyncState === "saving") {
      return "Saving...";
    }
    return `Online - Last sync ${lastSyncRelative}`;
  }, [currentSyncState, data.retryQueueCount, lastSyncRelative]);

  const sharedAccessLabel = useMemo(() => {
    if (!effectiveSelection) {
      return "Not selected";
    }
    if (sharedAccess.status === "loading") {
      return "Checking...";
    }
    if (sharedAccess.status === "error") {
      return "Access check failed";
    }
    return sharedAccess.message ?? "Unknown";
  }, [effectiveSelection, sharedAccess.message, sharedAccess.status]);

  const sharedSummary = useMemo(() => {
    if (!isSignedIn) {
      return "Not signed in";
    }
    if (!effectiveSelection) {
      return "Not selected";
    }
    const base = `Selected: ${effectiveSelection.name}`;
    if (sharedAccess.status === "loading") {
      return `${base} - Checking access...`;
    }
    if (sharedAccess.status === "error") {
      return `${base} - Access unavailable`;
    }
    return `${base} - ${sharedAccess.message ?? "Access unknown"}`;
  }, [effectiveSelection, isSignedIn, sharedAccess.message, sharedAccess.status]);

  const appearanceSummary = formatThemePreference(preference);
  const advancedSummary = "Diagnostics & tools";
  const dangerSummary = "Delete cloud data";

  const settingsListItems = useMemo(
    () => [
      {
        id: "provider-sign-in" as const,
        title: SETTINGS_SECTION_TITLES["provider-sign-in"],
        summary: providerSummary,
      },
      {
        id: "connection-health" as const,
        title: SETTINGS_SECTION_TITLES["connection-health"],
        summary: connectionSummary,
      },
      {
        id: "shared" as const,
        title: SETTINGS_SECTION_TITLES.shared,
        summary: sharedSummary,
      },
      {
        id: "appearance" as const,
        title: SETTINGS_SECTION_TITLES.appearance,
        summary: appearanceSummary,
      },
      {
        id: "advanced-diagnostics" as const,
        title: SETTINGS_SECTION_TITLES["advanced-diagnostics"],
        summary: advancedSummary,
      },
      {
        id: "danger-zone" as const,
        title: SETTINGS_SECTION_TITLES["danger-zone"],
        summary: dangerSummary,
        tone: "danger" as const,
      },
    ],
    [
      appearanceSummary,
      connectionSummary,
      dangerSummary,
      providerSummary,
      sharedSummary,
      advancedSummary,
    ],
  );

  const loadSharedRoots = useCallback(async () => {
    if (!isSignedIn || !data.isOnline) {
      setSharedRoots([]);
      setSharedRootsState({ status: "idle", message: null });
      return;
    }
    setSharedRootsState({ status: "loading", message: "Loading shared folders..." });
    try {
      const [withMe, byMe] = await Promise.all([
        oneDrive.listSharedWithMeRoots(),
        oneDrive.listSharedByMeRoots(),
      ]);
      setSharedRoots(mergeSharedRoots([...withMe, ...byMe]));
      setSharedRootsState({ status: "ready", message: null });
    } catch (err) {
      setSharedRootsState({ status: "error", message: getUserMessage(err) });
    }
  }, [data.isOnline, isSignedIn, oneDrive]);

  const handleRetryNow = useCallback(async () => {
    if (data.retryQueueCount <= 0) {
      setSyncState({ status: "success", message: "No retry is needed." });
      return;
    }
    setSyncState({ status: "working", message: "Retrying queued sync operations..." });
    try {
      const result = await data.saveChanges();
      if (result.ok) {
        setSyncState({ status: "success", message: "Retry completed." });
        return;
      }
      setSyncState({
        status: "error",
        message: getSaveErrorMessage(result.reason, result.error),
      });
    } catch (err) {
      setSyncState({ status: "error", message: getUserMessage(err) });
    }
  }, [data]);

  const handleReloadFromCloud = useCallback(async () => {
    setSyncState({ status: "working", message: "Reloading from cloud..." });
    try {
      await data.refresh();
      setSyncState({ status: "success", message: "Reloaded from cloud." });
    } catch (err) {
      setSyncState({ status: "error", message: getUserMessage(err) });
    }
  }, [data]);

  const handleClearCacheAndReload = useCallback(async () => {
    setSyncState({ status: "working", message: "Clearing cache and reloading..." });
    try {
      await clearSnapshotCache();
      window.location.reload();
    } catch (err) {
      setSyncState({ status: "error", message: getUserMessage(err) });
    }
  }, []);

  const handleEnsureRoot = useCallback(async () => {
    setDriveState({
      status: "working",
      message: "Checking the app folder...",
    });
    try {
      const result = await oneDrive.ensureAppRoot();
      setDriveState({
        status: "success",
        message: "App folder is ready.",
        payload: result,
      });
    } catch (err) {
      setDriveState({
        status: "error",
        message: getUserMessage(err),
      });
    }
  }, [oneDrive]);

  const handleWriteTestFile = useCallback(async () => {
    setDriveState({
      status: "working",
      message: `Writing ${DEFAULT_TEST_FILE_NAME}...`,
    });
    try {
      await oneDrive.ensureAppRoot();
      const payload = {
        message: "Hello from Piggy Bank.",
        updatedAt: new Date().toISOString(),
      };
      const result = await oneDrive.writeJsonFile(DEFAULT_TEST_FILE_NAME, payload);
      setDriveState({
        status: "success",
        message: `Wrote ${DEFAULT_TEST_FILE_NAME}.`,
        payload: result,
      });
    } catch (err) {
      setDriveState({
        status: "error",
        message: getUserMessage(err),
      });
    }
  }, [oneDrive]);

  const handleReadTestFile = useCallback(async () => {
    setDriveState({
      status: "working",
      message: `Reading ${DEFAULT_TEST_FILE_NAME}...`,
    });
    try {
      await oneDrive.ensureAppRoot();
      const result = await oneDrive.readJsonFile(DEFAULT_TEST_FILE_NAME);
      setDriveState({
        status: "success",
        message: `Read ${DEFAULT_TEST_FILE_NAME}.`,
        payload: result,
      });
    } catch (err) {
      setDriveState({
        status: "error",
        message: getUserMessage(err),
      });
    }
  }, [oneDrive]);

  const handleExportSnapshot = useCallback(
    async (scope: "personal" | "shared") => {
      if (!isSignedIn) {
        setExportState({ status: "error", message: "Sign in to export data." });
        return;
      }
      if (scope === "shared" && !sharedRoot) {
        setExportState({ status: "error", message: "Select a shared folder first." });
        return;
      }
      setExportState({
        status: "working",
        message: `Preparing ${scope} snapshot export...`,
      });
      try {
        const timestamp = buildExportTimestamp();
        if (scope === "personal") {
          await oneDrive.ensureAppRoot();
          const result = await oneDrive.readPersonalSnapshot();
          const payload = JSON.stringify(result.snapshot, null, 2);
          downloadBlob(
            new Blob([payload], { type: "application/json" }),
            `mazemaze-piggy-bank-personal-snapshot-${timestamp}.json`,
          );
        } else {
          const result = await oneDrive.readSharedSnapshot(sharedRoot as SharedRootReference);
          const payload = JSON.stringify(result.snapshot, null, 2);
          downloadBlob(
            new Blob([payload], { type: "application/json" }),
            `mazemaze-piggy-bank-shared-snapshot-${timestamp}.json`,
          );
        }
        setExportState({
          status: "success",
          message: `Downloaded ${scope} snapshot.`,
        });
      } catch (err) {
        setExportState({ status: "error", message: getUserMessage(err) });
      }
    },
    [isSignedIn, oneDrive, sharedRoot],
  );

  const handleExportEvents = useCallback(
    async (scope: "personal" | "shared") => {
      if (!isSignedIn) {
        setExportState({ status: "error", message: "Sign in to export data." });
        return;
      }
      if (scope === "shared" && !sharedRoot) {
        setExportState({ status: "error", message: "Select a shared folder first." });
        return;
      }
      setExportState({
        status: "working",
        message: `Preparing ${scope} event export...`,
      });
      try {
        const timestamp = buildExportTimestamp();
        const chunkIds =
          scope === "personal"
            ? await oneDrive.listEventChunkIds()
            : await oneDrive.listSharedEventChunkIds(sharedRoot as SharedRootReference);
        if (chunkIds.length === 0) {
          setExportState({ status: "error", message: "No event logs found to export." });
          return;
        }
        const sortedChunkIds = [...chunkIds].sort((a, b) => a - b);
        const chunks = await Promise.all(
          sortedChunkIds.map((chunkId) =>
            scope === "personal"
              ? oneDrive.readEventChunk(chunkId)
              : oneDrive.readSharedEventChunk(sharedRoot as SharedRootReference, chunkId),
          ),
        );
        const payload = chunks.join("\n");
        downloadBlob(
          new Blob([payload], { type: "text/plain" }),
          `mazemaze-piggy-bank-${scope}-events-${timestamp}.jsonl`,
        );
        setExportState({
          status: "success",
          message: `Downloaded ${scope} event logs.`,
        });
      } catch (err) {
        setExportState({ status: "error", message: getUserMessage(err) });
      }
    },
    [isSignedIn, oneDrive, sharedRoot],
  );

  const handleSharedSelectionChange = useCallback(
    (nextSharedId: string) => {
      setShareLinkUrl("");
      setShareLinkState({ status: "idle", message: null });
      if (!nextSharedId) {
        setSelection(null);
        return;
      }
      const target = sharedRoots.find((root) => root.sharedId === nextSharedId);
      if (!target) {
        return;
      }
      setSelection({
        sharedId: target.sharedId,
        driveId: target.driveId,
        itemId: target.itemId,
        name: target.name,
        webUrl: target.webUrl,
      });
    },
    [setSelection, sharedRoots],
  );

  const handleCreateSharedFolder = useCallback(async () => {
    if (!isSignedIn) {
      setSharedState({ status: "error", message: "Sign in to create shared folders." });
      return;
    }
    if (!data.isOnline) {
      setSharedState({ status: "error", message: "Reconnect to create shared folders." });
      return;
    }
    const normalized = createFolderName.trim();
    if (!normalized) {
      setSharedState({ status: "error", message: "Enter a folder name." });
      return;
    }
    setSharedState({ status: "working", message: "Creating shared folder..." });
    try {
      const created = await oneDrive.createSharedFolder(normalized);
      setSharedRoots((prev) => mergeSharedRoots([...prev, created]));
      setCreateFolderName("");
      setCreateDialogOpen(false);
      setSharedState({ status: "success", message: `Created "${created.name}".` });
    } catch (err) {
      setSharedState({ status: "error", message: getUserMessage(err) });
    }
  }, [createFolderName, data.isOnline, isSignedIn, oneDrive]);

  const handleCreateShareLink = useCallback(async () => {
    if (!isSignedIn) {
      setShareLinkState({ status: "error", message: "Sign in to create share links." });
      return;
    }
    if (!data.isOnline) {
      setShareLinkState({ status: "error", message: "Reconnect to create share links." });
      return;
    }
    if (!sharedRoot) {
      setShareLinkState({ status: "error", message: "Select a shared folder first." });
      return;
    }
    setShareLinkState({ status: "working", message: "Creating share link..." });
    try {
      const result = await oneDrive.createShareLink(sharedRoot, shareLinkPermission);
      setShareLinkUrl(result.webUrl);
      const copied = await copyToClipboard(result.webUrl);
      setShareLinkState({
        status: "success",
        message: copied ? "Share link copied." : "Share link created.",
        payload: null,
      });
    } catch (err) {
      const detail = getUserMessage(err);
      setShareLinkState({
        status: "error",
        message: "Could not create a share link.",
        payload: detail,
      });
    }
  }, [data.isOnline, isSignedIn, oneDrive, shareLinkPermission, sharedRoot]);

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLinkUrl) {
      setShareLinkState({ status: "error", message: "Create a share link first." });
      return;
    }
    const copied = await copyToClipboard(shareLinkUrl);
    if (copied) {
      setShareLinkState({ status: "success", message: "Copied.", payload: null });
      return;
    }
    setShareLinkState({
      status: "error",
      message: "Copy failed. Copy the link manually.",
      payload: null,
    });
  }, [shareLinkUrl]);

  const handleCopySharedPath = useCallback(async () => {
    const copied = await copyToClipboard(appRootLabel);
    setCopyPathMessage(copied ? "Path copied." : "Copy failed. Copy the path manually.");
  }, [appRootLabel]);

  const handleOpenInOneDrive = useCallback(async () => {
    if (selectedSharedWebUrl) {
      window.open(selectedSharedWebUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!sharedRoot) {
      setShareLinkState({ status: "error", message: "Select a shared folder first." });
      return;
    }
    setShareLinkState({ status: "working", message: "Resolving OneDrive link..." });
    try {
      const info = await oneDrive.getSharedRootInfo(sharedRoot);
      if (!info.webUrl) {
        setShareLinkState({ status: "error", message: "Could not resolve OneDrive link." });
        return;
      }
      window.open(info.webUrl, "_blank", "noopener,noreferrer");
      setShareLinkState({ status: "success", message: "Opened in OneDrive." });
    } catch (err) {
      setShareLinkState({ status: "error", message: getUserMessage(err) });
    }
  }, [oneDrive, selectedSharedWebUrl, sharedRoot]);

  const openDeleteDialog = () => {
    setDeleteDialogOpen(true);
    setDeleteStep(1);
    setDeleteAcknowledge(false);
    setDeleteConfirmText("");
  };

  const closeDeleteDialog = () => {
    if (isDangerWorking) {
      return;
    }
    setDeleteDialogOpen(false);
    setDeleteStep(1);
    setDeleteAcknowledge(false);
    setDeleteConfirmText("");
  };

  const handleDeleteCloudData = useCallback(async () => {
    if (!isSignedIn) {
      setDangerState({ status: "error", message: "Sign in to delete cloud data." });
      return;
    }
    setDangerState({ status: "working", message: "Deleting cloud data..." });
    try {
      await oneDrive.deleteAppCloudData();
      await clearSnapshotCache();
      clearSelection();
      setDangerState({ status: "success", message: "Cloud data deleted. Reloading..." });
      window.location.assign("/dashboard");
    } catch (err) {
      setDangerState({ status: "error", message: getUserMessage(err) });
    }
  }, [clearSelection, isSignedIn, oneDrive]);

  const openSection = useCallback((sectionId: SettingsSectionId) => {
    setActiveSectionId(sectionId);
    setOverlayOrigin("list");
    if (typeof window === "undefined") {
      return;
    }
    const nextHash = `#${sectionId}`;
    if (window.location.hash !== nextHash) {
      suppressNextHashOrigin.current = true;
      window.location.hash = sectionId;
    }
  }, []);

  const closeSection = useCallback(() => {
    if (typeof window === "undefined") {
      setActiveSectionId(null);
      setOverlayOrigin(null);
      return;
    }
    if (overlayOrigin === "list") {
      window.history.back();
      return;
    }
    const nextUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", nextUrl);
    setActiveSectionId(null);
    setOverlayOrigin(null);
  }, [overlayOrigin]);

  const syncOverlayWithHash = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isMobileViewport) {
      setActiveSectionId(null);
      setOverlayOrigin(null);
      return;
    }
    const sectionId = resolveHashSection(window.location.hash);
    if (!sectionId) {
      setActiveSectionId(null);
      setOverlayOrigin(null);
      return;
    }
    setActiveSectionId(sectionId);
    if (suppressNextHashOrigin.current) {
      suppressNextHashOrigin.current = false;
      return;
    }
    setOverlayOrigin("hash");
  }, [isMobileViewport]);

  const scrollToHashTarget = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (isMobileViewport) {
      return;
    }
    const rawHash = window.location.hash.replace("#", "");
    if (!rawHash) {
      return;
    }
    const target = document.getElementById(rawHash);
    if (!target) {
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [isMobileViewport]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setIsSelectionHydrated(true);
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia("(max-width: 719px)");
    const apply = () => setIsMobileViewport(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleHashChange = () => {
      scrollToHashTarget();
      syncOverlayWithHash();
    };
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [scrollToHashTarget, syncOverlayWithHash]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      scrollToHashTarget();
      syncOverlayWithHash();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [isMobileViewport, scrollToHashTarget, syncOverlayWithHash]);

  useEffect(() => {
    if (!copyPathMessage) {
      return;
    }
    const timerId = window.setTimeout(() => {
      setCopyPathMessage(null);
    }, 4000);
    return () => window.clearTimeout(timerId);
  }, [copyPathMessage]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadSharedRoots();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadSharedRoots]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!isSignedIn || !sharedRoot) {
        if (active) {
          setSharedAccess({ status: "idle", message: null });
        }
        return;
      }
      if (active) {
        setSharedAccess({ status: "loading", message: "Checking shared access..." });
      }
      try {
        const info = await oneDrive.getSharedRootInfo(sharedRoot);
        if (!active) {
          return;
        }
        setSharedAccess({ status: "ready", message: info.canWrite ? "Can edit" : "View-only" });
      } catch (err) {
        if (!active) {
          return;
        }
        setSharedAccess({ status: "error", message: getUserMessage(err) });
      }
    };
    const timerId = window.setTimeout(() => {
      void run();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [isSignedIn, oneDrive, sharedRoot]);

  const shareLinkDetail =
    typeof shareLinkState.payload === "string" ? shareLinkState.payload : null;

  const renderProviderBody = () => (
    <>
      <div className="settings-row-grid" role="list">
        <div className="settings-row" role="listitem">
          <span className="app-muted">Provider</span>
          <strong>OneDrive</strong>
        </div>
        <div className="settings-row" role="listitem">
          <span className="app-muted">Signed in as</span>
          <strong>{isSignedIn ? accountLabel : "Not signed in"}</strong>
        </div>
      </div>
      <p className="app-muted" style={{ marginTop: 8 }}>
        {signInStatus}
      </p>
      <div className="app-actions" style={{ marginTop: 12 }}>
        {status === "signed_in" ? (
          <Button onClick={signOut} disabled={isAuthLoading}>
            Sign out
          </Button>
        ) : (
          <Button appearance="primary" onClick={signIn} disabled={isAuthLoading || isAuthBlocked}>
            Sign in
          </Button>
        )}
        {isAuthLoading ? <Spinner size="tiny" /> : null}
      </div>
      {error ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>{error}</Text>
        </div>
      ) : null}
    </>
  );

  const renderConnectionHealthBody = () => (
    <>
      <p className="app-muted">Status details and recovery actions are grouped here.</p>
      <div className="settings-status-line" role="status" aria-live="polite">
        <span className={`status-dot status-dot-${currentSyncMeta.tone}`} aria-hidden />
        <span>
          Status: <strong>{currentSyncMeta.label}</strong>
        </span>
      </div>
      <p className="app-muted" title={lastSyncAbsolute ?? undefined}>
        Last sync: {lastSyncRelative}
      </p>
      <div className="app-actions" style={{ marginTop: 12 }}>
        <Button onClick={() => void handleRetryNow()} disabled={retryNowDisabled}>
          Retry now
        </Button>
        <Button onClick={() => void handleClearCacheAndReload()} disabled={isSyncWorking}>
          Clear cache &amp; reload
        </Button>
        <Button
          onClick={() => void handleReloadFromCloud()}
          disabled={!isSignedIn || !data.isOnline || isSyncWorking || data.activity !== "idle"}
        >
          Reload from cloud
        </Button>
        {isSyncWorking ? <Spinner size="tiny" /> : null}
      </div>
      {retryNowDisabled && retryNowDisabledReason ? (
        <p className="app-muted settings-help-text">{retryNowDisabledReason}</p>
      ) : null}
      <details className="settings-details" style={{ marginTop: 12 }}>
        <summary>Show details</summary>
        <div className="settings-row-grid" role="list" style={{ marginTop: 12 }}>
          <div className="settings-row" role="listitem">
            <span className="app-muted">Retry queue</span>
            <strong>{data.retryQueueCount}</strong>
          </div>
          <div className="settings-row" role="listitem">
            <span className="app-muted">Snapshot version</span>
            <strong>{data.snapshot?.version ?? "—"}</strong>
          </div>
        </div>
      </details>
      {syncState.message ? (
        <div
          className={`app-alert ${syncState.status === "error" ? "app-alert-error" : ""}`}
          role="status"
        >
          <Text>{syncState.message}</Text>
        </div>
      ) : null}
      {data.message ? (
        <div className="app-alert" role="status">
          <Text>{data.message}</Text>
        </div>
      ) : null}
      {data.error ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>{data.error}</Text>
        </div>
      ) : null}
    </>
  );

  const renderSharedBody = () => (
    <>
      <p className="app-muted">Manage shared folder selection in one place.</p>
      <div className="settings-subsection">
        <h3>Shared folder</h3>
        <p className="app-muted">Select or create the shared folder used by this app.</p>
        <div className="settings-row-grid" role="list">
          <div className="settings-row" role="listitem">
            <span className="app-muted">Selected folder</span>
            <strong>
              {effectiveSelection ? effectiveSelection.name : "No shared folder selected"}
            </strong>
          </div>
          <div className="settings-row" role="listitem">
            <span className="app-muted">Access</span>
            {sharedAccess.status === "ready" ? (
              <span className="settings-chip">{sharedAccess.message ?? "Unknown"}</span>
            ) : (
              <strong>{sharedAccessLabel}</strong>
            )}
          </div>
          <div className="settings-row" role="listitem">
            <span className="app-muted">Available folders</span>
            <strong>{sharedRoots.length}</strong>
          </div>
        </div>
        <div className="settings-location">
          <span className="app-muted">Location</span>
          <div className="settings-location-row">
            <span className="settings-truncate" title={appRootLabel}>
              {appRootLabel}
            </span>
            <Button onClick={() => void handleCopySharedPath()}>Copy path</Button>
          </div>
          {copyPathMessage ? (
            <p className="app-muted settings-help-text">{copyPathMessage}</p>
          ) : null}
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="app-muted" htmlFor="settings-shared-folder">
            Shared folder
          </label>
          <select
            id="settings-shared-folder"
            className="scope-select"
            value={selectedSharedId}
            onChange={(event) => handleSharedSelectionChange(event.target.value)}
            disabled={!isSignedIn || !data.isOnline || sharedRootsState.status === "loading"}
            style={{ marginTop: 6 }}
          >
            <option value="">Not selected</option>
            {sharedRoots.map((root) => (
              <option key={root.sharedId} value={root.sharedId}>
                {root.name}
              </option>
            ))}
          </select>
        </div>
        <div className="app-actions" style={{ marginTop: 12 }}>
          <Button
            onClick={() => {
              setCreateFolderName("");
              setCreateDialogOpen(true);
            }}
            disabled={!isSignedIn || !data.isOnline || isSharedWorking}
          >
            Create shared folder…
          </Button>
          <Button
            onClick={() => void loadSharedRoots()}
            disabled={!isSignedIn || !data.isOnline || sharedRootsState.status === "loading"}
          >
            Refresh list
          </Button>
          {sharedRootsState.status === "loading" || isSharedWorking ? (
            <Spinner size="tiny" />
          ) : null}
        </div>
        <p className="app-muted" style={{ marginTop: 10 }}>
          Creating a folder doesn&apos;t share it automatically.
        </p>
        {sharedRootsState.message ? (
          <div
            className={`app-alert ${sharedRootsState.status === "error" ? "app-alert-error" : ""}`}
          >
            <Text>{sharedRootsState.message}</Text>
          </div>
        ) : null}
        {sharedState.message ? (
          <div className={`app-alert ${sharedState.status === "error" ? "app-alert-error" : ""}`}>
            <Text>{sharedState.message}</Text>
          </div>
        ) : null}
        {sharedAccess.status === "error" && sharedAccess.message ? (
          <div className="app-alert app-alert-error" role="alert">
            <Text>{sharedAccess.message}</Text>
          </div>
        ) : null}
      </div>
      <div className="settings-subsection">
        <h3>Share link</h3>
        <p className="app-muted">Create a share link for the selected folder.</p>
        <div className="settings-field">
          <span className="app-muted">Access type</span>
          <RadioGroup
            value={shareLinkPermission}
            onChange={(_, radioData) =>
              setShareLinkPermission(radioData.value as ShareLinkPermission)
            }
            aria-label="Share link access type"
            className="settings-access-type"
          >
            <Radio value="view" label="View" />
            <Radio value="edit" label="Edit" />
          </RadioGroup>
        </div>
        <div className="app-actions" style={{ marginTop: 12 }}>
          <Button onClick={() => void handleCreateShareLink()} disabled={isShareLinkDisabled}>
            Create link
          </Button>
          {isShareLinkWorking ? <Spinner size="tiny" /> : null}
        </div>
        {shareLinkDisabledReason ? (
          <p className="app-muted settings-help-text">{shareLinkDisabledReason}</p>
        ) : null}
        {shareLinkUrl ? (
          <div className="settings-share-link-row">
            <input
              className="settings-text-input settings-share-link-input"
              value={shareLinkUrl}
              readOnly
              aria-label="Share link"
            />
            <Button onClick={() => void handleCopyShareLink()} disabled={isShareLinkWorking}>
              Copy
            </Button>
          </div>
        ) : null}
        <p className="app-muted" style={{ marginTop: 10 }}>
          Creating a link doesn&apos;t share it automatically - only people you send the link to can
          access it.
        </p>
        {shareLinkState.message ? (
          <div
            className={`app-alert ${shareLinkState.status === "error" ? "app-alert-error" : ""}`}
            role="status"
          >
            <Text>{shareLinkState.message}</Text>
            {shareLinkDetail ? (
              <details className="settings-details" style={{ marginTop: 10 }}>
                <summary>Show details</summary>
                <p className="app-muted" style={{ marginTop: 8 }}>
                  {shareLinkDetail}
                </p>
              </details>
            ) : null}
            {shareLinkState.status === "error" && sharedRoot ? (
              <div className="app-actions" style={{ marginTop: 8 }}>
                <Button onClick={() => void handleOpenInOneDrive()} disabled={isShareLinkWorking}>
                  Open in OneDrive
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  const renderAppearanceBody = () => (
    <>
      <p className="app-muted">Use system setting or choose a theme manually.</p>
      <RadioGroup
        value={preference}
        onChange={(_, radioData) => setPreference(radioData.value as ThemePreference)}
        aria-label="Theme selection"
      >
        <Radio value="system" label="System" />
        <Radio value="light" label="Light" />
        <Radio value="dark" label="Dark" />
      </RadioGroup>
      <p className="app-muted">
        Current mode:{" "}
        <span suppressHydrationWarning>
          {isMounted ? (mode === "dark" ? "Dark" : "Light") : "Light"}
        </span>
      </p>
    </>
  );

  const renderAdvancedBody = () => (
    <details className="settings-details">
      <summary>Show diagnostics</summary>
      <div className="section-stack" style={{ marginTop: 12 }}>
        <div className="app-surface">
          <h3>OneDrive checks</h3>
          <p className="app-muted">Run low-level checks against the app folder.</p>
          <div className="app-actions">
            <Button onClick={handleEnsureRoot} disabled={!isSignedIn || isDriveWorking}>
              Check app folder
            </Button>
            <Button onClick={handleWriteTestFile} disabled={!isSignedIn || isDriveWorking}>
              Write test file
            </Button>
            <Button onClick={handleReadTestFile} disabled={!isSignedIn || isDriveWorking}>
              Read test file
            </Button>
            {isDriveWorking ? <Spinner size="tiny" /> : null}
          </div>
          <p className="app-muted">Test file: {DEFAULT_TEST_FILE_NAME}</p>
          {driveState.message ? (
            <div
              className={`app-alert ${driveState.status === "error" ? "app-alert-error" : ""}`}
              role="status"
            >
              <Text>{driveState.message}</Text>
            </div>
          ) : null}
          {driveState.payload ? (
            <pre className="app-code">{formatPayload(driveState.payload)}</pre>
          ) : null}
        </div>

        <div className="app-surface">
          <h3>Export</h3>
          <p className="app-muted">
            Download snapshots and event logs for personal data or the selected shared folder.
          </p>
          <div className="app-actions">
            <Button
              onClick={() => void handleExportSnapshot("personal")}
              disabled={!isSignedIn || isExportWorking}
            >
              Download personal snapshot
            </Button>
            <Button
              onClick={() => void handleExportEvents("personal")}
              disabled={!isSignedIn || isExportWorking}
            >
              Download personal events
            </Button>
            <Button
              onClick={() => void handleExportSnapshot("shared")}
              disabled={!isSignedIn || isExportWorking || !sharedRoot}
            >
              Download shared snapshot
            </Button>
            <Button
              onClick={() => void handleExportEvents("shared")}
              disabled={!isSignedIn || isExportWorking || !sharedRoot}
            >
              Download shared events
            </Button>
            {isExportWorking ? <Spinner size="tiny" /> : null}
          </div>
          {exportState.message ? (
            <div
              className={`app-alert ${exportState.status === "error" ? "app-alert-error" : ""}`}
              role="status"
            >
              <Text>{exportState.message}</Text>
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );

  const renderDangerBody = () => (
    <>
      <p className="app-muted">
        Delete cloud data removes the app folder content under your configured app root in OneDrive.
      </p>
      <div className="app-actions" style={{ marginTop: 12 }}>
        <Button
          appearance="secondary"
          onClick={openDeleteDialog}
          disabled={!isSignedIn || isDangerWorking}
        >
          Delete cloud data
        </Button>
        {isDangerWorking ? <Spinner size="tiny" /> : null}
      </div>
      {dangerState.message ? (
        <div
          className={`app-alert ${dangerState.status === "error" ? "app-alert-error" : ""}`}
          role="status"
        >
          <Text>{dangerState.message}</Text>
        </div>
      ) : null}
    </>
  );

  const renderSectionBody = (sectionId: SettingsSectionId) => {
    switch (sectionId) {
      case "provider-sign-in":
        return renderProviderBody();
      case "connection-health":
        return renderConnectionHealthBody();
      case "shared":
        return renderSharedBody();
      case "appearance":
        return renderAppearanceBody();
      case "advanced-diagnostics":
        return renderAdvancedBody();
      case "danger-zone":
        return renderDangerBody();
      default:
        return null;
    }
  };

  return (
    <div className="section-stack">
      <h1 className="settings-page-title">Settings</h1>
      <div className="settings-mobile-only">
        <div className="settings-mobile-list" role="list">
          {settingsListItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-mobile-item ${
                item.tone === "danger" ? "settings-mobile-item-danger" : ""
              }`}
              onClick={() => openSection(item.id)}
              role="listitem"
              aria-label={`${item.title}. ${item.summary}`}
            >
              <span className="settings-mobile-item-title">{item.title}</span>
              <span className="settings-mobile-item-summary">{item.summary}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-desktop-only section-stack">
        {SETTINGS_SECTION_IDS.map((sectionId) => (
          <section
            key={sectionId}
            className={`app-surface settings-anchor ${
              sectionId === "danger-zone" ? "danger-zone" : ""
            }`}
            id={sectionId}
          >
            <h2>{SETTINGS_SECTION_TITLES[sectionId]}</h2>
            {renderSectionBody(sectionId)}
          </section>
        ))}
      </div>

      {isMobileViewport && activeSectionId ? (
        <div className="settings-overlay" onClick={closeSection}>
          <section
            className="settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`settings-overlay-title-${activeSectionId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-drawer-header">
              <strong id={`settings-overlay-title-${activeSectionId}`}>
                {SETTINGS_SECTION_TITLES[activeSectionId]}
              </strong>
              <Button onClick={closeSection}>Close</Button>
            </header>
            <div className="section-stack">{renderSectionBody(activeSectionId)}</div>
          </section>
        </div>
      ) : null}

      {createDialogOpen ? (
        <div className="settings-modal-overlay" onClick={() => setCreateDialogOpen(false)}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-shared-folder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="create-shared-folder-title">Create shared folder</h3>
            <p className="app-muted">
              Enter a folder name. The folder is not shared automatically.
            </p>
            <label className="app-muted" htmlFor="create-shared-folder-input">
              Folder name
            </label>
            <input
              id="create-shared-folder-input"
              className="settings-text-input"
              value={createFolderName}
              onChange={(event) => setCreateFolderName(event.target.value)}
              placeholder="e.g. Family budget"
              autoFocus
            />
            <div className="app-actions" style={{ marginTop: 16 }}>
              <Button onClick={() => setCreateDialogOpen(false)} disabled={isSharedWorking}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => void handleCreateSharedFolder()}
                disabled={isSharedWorking}
              >
                Create folder
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialogOpen ? (
        <div className="settings-modal-overlay" onClick={closeDeleteDialog}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-cloud-data-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="delete-cloud-data-title">Delete cloud data</h3>
            {deleteStep === 1 ? (
              <>
                <p className="app-muted">
                  This permanently removes snapshots, events, and leases from your app folder in
                  OneDrive.
                </p>
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={deleteAcknowledge}
                    onChange={(event) => setDeleteAcknowledge(event.target.checked)}
                  />
                  <span>I understand</span>
                </label>
                <div className="app-actions" style={{ marginTop: 16 }}>
                  <Button onClick={closeDeleteDialog} disabled={isDangerWorking}>
                    Cancel
                  </Button>
                  <Button
                    appearance="primary"
                    disabled={!deleteAcknowledge || isDangerWorking}
                    onClick={() => setDeleteStep(2)}
                  >
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="app-muted">Type DELETE to confirm.</p>
                <input
                  className="settings-text-input"
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  autoFocus
                />
                <div className="app-actions" style={{ marginTop: 16 }}>
                  <Button onClick={() => setDeleteStep(1)} disabled={isDangerWorking}>
                    Back
                  </Button>
                  <Button
                    appearance="primary"
                    disabled={deleteConfirmText !== "DELETE" || isDangerWorking}
                    onClick={() => void handleDeleteCloudData()}
                  >
                    Delete cloud data
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
