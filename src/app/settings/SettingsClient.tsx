"use client";

import { Button, Radio, RadioGroup, Spinner, Text } from "@fluentui/react-components";
import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { type ThemePreference, useTheme } from "@/components/AppProviders";
import { usePersonalData } from "@/components/PersonalDataProvider";
import { useSharedSelection } from "@/components/SharedSelectionProvider";
import { useStorageProviderContext } from "@/components/StorageProviderContext";
import { isAuthError } from "@/lib/auth/authErrors";
import { DEFAULT_TEST_FILE_NAME } from "@/lib/onedrive/oneDriveService";
import {
  parseEventChunk,
  serializeEventChunk,
  type EventChunk,
} from "@/lib/persistence/eventChunk";
import { parseSnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import { clearSnapshotCache, clearSnapshotCacheForProvider } from "@/lib/persistence/snapshotCache";
import { getSyncIndicatorMeta, resolveSyncIndicatorState } from "@/lib/persistence/syncStatus";
import { formatStorageError, isStorageNotFound } from "@/lib/storage/storageErrors";
import { createStorageService } from "@/lib/storage/storageService";
import type {
  CloudProviderId,
  RootFolderNotice,
  ShareLinkPermission,
  SharedRootListItem,
  SharedRootReference,
} from "@/lib/storage/types";
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

type MoveProgress = {
  phase: "prepare" | "snapshot" | "events" | "cleanup";
  message: string;
  current?: number;
  total?: number;
};

type SettingsSectionId =
  | "sign-in-storage"
  | "connection-health"
  | "workspace"
  | "data-portability"
  | "appearance"
  | "advanced-diagnostics"
  | "danger-zone";

const SHARE_LINK_RADIO_NAME = "settings-share-link-access";
const SHARE_LINK_RADIO_VIEW_ID = "settings-share-link-view";
const SHARE_LINK_RADIO_EDIT_ID = "settings-share-link-edit";
const THEME_RADIO_NAME = "settings-theme";
const THEME_RADIO_SYSTEM_ID = "settings-theme-system";
const THEME_RADIO_LIGHT_ID = "settings-theme-light";
const THEME_RADIO_DARK_ID = "settings-theme-dark";

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

const isString = (value: unknown): value is string => typeof value === "string";

const isProviderId = (value: unknown): value is CloudProviderId =>
  value === "onedrive" || value === "gdrive";

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
    if (error.code === "not-signed-in") {
      return "You are not signed in. Please sign in first.";
    }
    return error.message || "Sign-in failed. Please try again.";
  }
  return formatStorageError(error);
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

const EXPORT_SCHEMA_VERSION = 1;
const EXPORT_MANIFEST_FILE = "manifest.json";
const EXPORT_SNAPSHOT_FILE = "snapshot.json";
const EXPORT_EVENTS_FILE = "events.jsonl";

type ExportManifest = {
  schemaVersion: number;
  createdAt: string;
  scope: "personal" | "shared";
  provider?: CloudProviderId;
  snapshotFile: string;
  eventsFile?: string;
};

type ImportPayload = {
  manifest: ExportManifest;
  snapshot: Snapshot;
  eventChunks: EventChunk[];
};

const parseExportManifest = (value: unknown): ExportManifest => {
  if (!isRecord(value)) {
    throw new Error("Manifest is invalid.");
  }
  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error("Export format is not supported.");
  }
  if (!isString(value.createdAt)) {
    throw new Error("Manifest createdAt is invalid.");
  }
  if (value.scope !== "personal" && value.scope !== "shared") {
    throw new Error("Manifest scope is invalid.");
  }
  if (!isString(value.snapshotFile)) {
    throw new Error("Manifest snapshot file is missing.");
  }
  const provider = isProviderId(value.provider) ? value.provider : undefined;
  const eventsFile = isString(value.eventsFile) ? value.eventsFile : undefined;
  return {
    schemaVersion,
    createdAt: value.createdAt,
    scope: value.scope,
    provider,
    snapshotFile: value.snapshotFile,
    eventsFile,
  };
};

const parseEventArchive = (content: string): EventChunk[] => {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed.split("\n").filter((line) => line.trim().length > 0);
  const chunks: EventChunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const headerLine = lines[index];
    let header: { eventCount?: number } & Partial<EventChunk>;
    try {
      header = JSON.parse(headerLine) as { eventCount?: number } & Partial<EventChunk>;
    } catch {
      throw new Error("Event log header is not valid JSON.");
    }
    if (!header || typeof header.eventCount !== "number") {
      throw new Error("Event log header is missing eventCount.");
    }
    const eventCount = header.eventCount;
    const slice = lines.slice(index, index + 1 + eventCount);
    if (slice.length < 1 + eventCount) {
      throw new Error("Event log is incomplete.");
    }
    const chunkContent = `${slice.join("\n")}\n`;
    const parsed = parseEventChunk(chunkContent);
    chunks.push(parsed);
    index += 1 + eventCount;
  }
  return chunks;
};

const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  "sign-in-storage",
  "connection-health",
  "workspace",
  "data-portability",
  "appearance",
  "advanced-diagnostics",
  "danger-zone",
];

const SETTINGS_SECTION_TITLES: Record<SettingsSectionId, string> = {
  "sign-in-storage": "Sign-in & storage",
  "connection-health": "Connection health",
  workspace: "Workspace",
  "data-portability": "Data & portability",
  appearance: "Appearance",
  "advanced-diagnostics": "Advanced / Diagnostics",
  "danger-zone": "Danger zone",
};

const PROVIDER_DESCRIPTIONS: Record<CloudProviderId, string> = {
  onedrive: "Save to your Microsoft account.",
  gdrive: "Save to your Google account.",
};

const PROVIDER_SIGNIN_LABELS: Record<CloudProviderId, string> = {
  onedrive: "Sign in with Microsoft",
  gdrive: "Sign in with Google",
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
  const { providers, signIn, signOut, getAccessToken } = useAuth();
  const { activeProviderId, setActiveProviderId } = useStorageProviderContext();
  const activeProvider = providers[activeProviderId];
  const { preference, setPreference, mode } = useTheme();
  const data = usePersonalData();
  const { selection, setSelection, clearSelection } = useSharedSelection();
  const now = useNow(60_000);
  const [isMounted] = useState(() => typeof window !== "undefined");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSelectionHydrated, setIsSelectionHydrated] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId | null>(null);
  const [overlayOrigin, setOverlayOrigin] = useState<"list" | "hash" | null>(null);
  const suppressNextHashOrigin = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [driveState, setDriveState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [exportState, setExportState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [importState, setImportState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [importPayload, setImportPayload] = useState<ImportPayload | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
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
  const [switchState, setSwitchState] = useState<OperationState>({
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
  const [rootNotices, setRootNotices] = useState<RootFolderNotice[]>([]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [copyPathMessage, setCopyPathMessage] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteAcknowledge, setDeleteAcknowledge] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [switchCandidates, setSwitchCandidates] = useState<
    {
      providerId: CloudProviderId;
      label: string;
      description: string;
      status: "available" | "empty" | "not_signed_in";
      accountLabel?: string;
      statusNote?: string;
      isActive: boolean;
    }[]
  >([]);
  const providerSnapshots = useMemo(
    () => ({
      onedrive: {
        status: providers.onedrive.status,
        error: providers.onedrive.error,
        account: providers.onedrive.account,
      },
      gdrive: {
        status: providers.gdrive.status,
        error: providers.gdrive.error,
        account: providers.gdrive.account,
      },
    }),
    [
      providers.gdrive.account,
      providers.gdrive.error,
      providers.gdrive.status,
      providers.onedrive.account,
      providers.onedrive.error,
      providers.onedrive.status,
    ],
  );
  const [switchLoading, setSwitchLoading] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveStep, setMoveStep] = useState<1 | 2>(1);
  const [moveAcknowledge, setMoveAcknowledge] = useState(false);
  const [moveBackupConfirm, setMoveBackupConfirm] = useState(false);
  const [moveConfirmText, setMoveConfirmText] = useState("");
  const [moveTargetProviderId, setMoveTargetProviderId] = useState<CloudProviderId | null>(null);
  const [moveProgress, setMoveProgress] = useState<MoveProgress | null>(null);

  const tokenProviders = useMemo(
    () => ({
      onedrive: (scopes: string[]) => getAccessToken("onedrive", scopes),
      gdrive: (scopes: string[]) => getAccessToken("gdrive", scopes),
    }),
    [getAccessToken],
  );

  const storageByProvider = useMemo(
    () => ({
      onedrive: createStorageService("onedrive", tokenProviders.onedrive),
      gdrive: createStorageService("gdrive", tokenProviders.gdrive),
    }),
    [tokenProviders],
  );
  const storage = storageByProvider[activeProviderId];

  const appRootLabel = isHydrated ? storage.appRootLabel : "Loading...";
  const storageLabel = isHydrated ? storage.label : "Loading...";
  const effectiveSelection = isSelectionHydrated ? selection : null;
  const sharedRoot = useMemo<SharedRootReference | null>(() => {
    if (!effectiveSelection) {
      return null;
    }
    return {
      providerId: activeProviderId,
      sharedId: effectiveSelection.sharedId,
      driveId: effectiveSelection.driveId,
      itemId: effectiveSelection.itemId,
    };
  }, [activeProviderId, effectiveSelection]);

  const isSignedIn = activeProvider.status === "signed_in";
  const isDriveWorking = driveState.status === "working";
  const isExportWorking = exportState.status === "working";
  const isImportWorking = importState.status === "working";
  const isSyncWorking = syncState.status === "working";
  const isSharedWorking = sharedState.status === "working";
  const isShareLinkWorking = shareLinkState.status === "working";
  const isDangerWorking = dangerState.status === "working";
  const isSwitchWorking = switchState.status === "working";

  const currentSyncState = resolveSyncIndicatorState({
    isOnline: data.isOnline,
    isSignedIn,
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

  useEffect(() => {
    let cancelled = false;
    if (!isSignedIn || !data.isOnline) {
      setRootNotices([]);
      return () => {
        cancelled = true;
      };
    }
    storage
      .getRootFolderNotices()
      .then((notices) => {
        if (cancelled) {
          return;
        }
        setRootNotices(notices);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRootNotices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data.isOnline, isSignedIn, storage]);

  const anySignedIn = Object.values(providers).some((provider) => provider.status === "signed_in");
  const signInSummary = isSignedIn
    ? `Connected to ${storage.label}`
    : anySignedIn
      ? "Sign-in required"
      : "Not signed in";

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
    if (!storage.capabilities.supportsShareLinks) {
      return "Share links are unavailable for this provider.";
    }
    if (!isSignedIn) {
      return "Sign in to create share links.";
    }
    if (!data.isOnline) {
      return "Reconnect to create share links.";
    }
    if (!sharedRoot) {
      return "Select a shared workspace first.";
    }
    if (isSharedWorking) {
      return "Wait for shared workspace updates to finish.";
    }
    if (isShareLinkWorking) {
      return "Creating share link...";
    }
    return null;
  }, [data.isOnline, isShareLinkWorking, isSharedWorking, isSignedIn, sharedRoot, storage]);
  const isShareLinkDisabled = Boolean(shareLinkDisabledReason);
  const importSummary = useMemo(() => {
    if (!importPayload) {
      return null;
    }
    const eventCount = importPayload.eventChunks.reduce(
      (sum, chunk) => sum + chunk.events.length,
      0,
    );
    return {
      scope: importPayload.manifest.scope,
      provider: importPayload.manifest.provider,
      createdAt: importPayload.manifest.createdAt,
      snapshotVersion: importPayload.snapshot.version,
      snapshotUpdatedAt: importPayload.snapshot.updatedAt,
      eventCount,
      chunkCount: importPayload.eventChunks.length,
    };
  }, [importPayload]);
  const importApplyDisabledReason = useMemo(() => {
    if (!importPayload) {
      return "Choose an export file first.";
    }
    if (!isSignedIn) {
      return "Sign in to import data.";
    }
    if (!data.isOnline) {
      return "Reconnect to import data.";
    }
    if (importPayload.manifest.scope === "shared" && !sharedRoot) {
      return "Select a shared workspace first.";
    }
    return null;
  }, [data.isOnline, importPayload, isSignedIn, sharedRoot]);
  const isImportApplyDisabled = Boolean(importApplyDisabledReason);

  const connectionSummary = useMemo(() => {
    if (currentSyncState === "retry_needed") {
      return `Retry needed - ${data.retryQueueCount} queued`;
    }
    if (currentSyncState === "offline") {
      return "Offline";
    }
    if (currentSyncState === "sign_in_required") {
      return "Sign-in required";
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
      return "Shared workspace not selected";
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
  const dataPortabilitySummary = "Export & import";
  const advancedSummary = "Diagnostics & tools";
  const dangerSummary = "Delete cloud data";

  const settingsListItems = useMemo(
    () => [
      {
        id: "sign-in-storage" as const,
        title: SETTINGS_SECTION_TITLES["sign-in-storage"],
        summary: signInSummary,
      },
      {
        id: "connection-health" as const,
        title: SETTINGS_SECTION_TITLES["connection-health"],
        summary: connectionSummary,
      },
      {
        id: "workspace" as const,
        title: SETTINGS_SECTION_TITLES.workspace,
        summary: sharedSummary,
      },
      {
        id: "data-portability" as const,
        title: SETTINGS_SECTION_TITLES["data-portability"],
        summary: dataPortabilitySummary,
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
      dataPortabilitySummary,
      signInSummary,
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
    if (!storage.capabilities.supportsShared) {
      setSharedRoots([]);
      setSharedRootsState({
        status: "error",
        message: "Shared workspaces are unavailable for this provider.",
      });
      return;
    }
    setSharedRootsState({ status: "loading", message: "Loading shared workspaces..." });
    try {
      const [withMe, byMe] = await Promise.all([
        storage.listSharedWithMeRoots(),
        storage.listSharedByMeRoots(),
      ]);
      setSharedRoots(mergeSharedRoots([...withMe, ...byMe]));
      setSharedRootsState({ status: "ready", message: null });
    } catch (err) {
      setSharedRootsState({ status: "error", message: getUserMessage(err) });
    }
  }, [data.isOnline, isSignedIn, storage]);

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
      const result = await storage.ensureAppRoot();
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
  }, [storage]);

  const handleWriteTestFile = useCallback(async () => {
    setDriveState({
      status: "working",
      message: `Writing ${DEFAULT_TEST_FILE_NAME}...`,
    });
    try {
      await storage.ensureAppRoot();
      const payload = {
        message: "Hello from Piggy Bank.",
        updatedAt: new Date().toISOString(),
      };
      const result = await storage.writeJsonFile(DEFAULT_TEST_FILE_NAME, payload);
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
  }, [storage]);

  const handleReadTestFile = useCallback(async () => {
    setDriveState({
      status: "working",
      message: `Reading ${DEFAULT_TEST_FILE_NAME}...`,
    });
    try {
      await storage.ensureAppRoot();
      const result = await storage.readJsonFile(DEFAULT_TEST_FILE_NAME);
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
  }, [storage]);

  const handleExportArchive = useCallback(
    async (scope: "personal" | "shared") => {
      if (!isSignedIn) {
        setExportState({ status: "error", message: "Sign in to export data." });
        return;
      }
      if (scope === "shared" && !sharedRoot) {
        setExportState({ status: "error", message: "Select a shared workspace first." });
        return;
      }
      setExportState({
        status: "working",
        message: `Preparing ${scope} export...`,
      });
      try {
        const snapshotResult =
          scope === "personal"
            ? await storage.readPersonalSnapshot()
            : await storage.readSharedSnapshot(sharedRoot as SharedRootReference);
        let chunkIds: number[] = [];
        try {
          chunkIds =
            scope === "personal"
              ? await storage.listEventChunkIds()
              : await storage.listSharedEventChunkIds(sharedRoot as SharedRootReference);
        } catch (err) {
          if (!isStorageNotFound(err)) {
            throw err;
          }
        }
        const sortedChunkIds = [...chunkIds].sort((a, b) => a - b);
        const chunks =
          sortedChunkIds.length > 0
            ? await Promise.all(
                sortedChunkIds.map((chunkId) =>
                  scope === "personal"
                    ? storage.readEventChunk(chunkId)
                    : storage.readSharedEventChunk(sharedRoot as SharedRootReference, chunkId),
                ),
              )
            : [];
        const parsedChunks = chunks.map((content) => parseEventChunk(content));
        const eventsPayload =
          parsedChunks.length > 0 ? parsedChunks.map(serializeEventChunk).join("") : null;
        const manifest: ExportManifest = {
          schemaVersion: EXPORT_SCHEMA_VERSION,
          createdAt: new Date().toISOString(),
          scope,
          provider: activeProviderId,
          snapshotFile: EXPORT_SNAPSHOT_FILE,
          eventsFile: eventsPayload ? EXPORT_EVENTS_FILE : undefined,
        };
        const zip = new JSZip();
        zip.file(EXPORT_MANIFEST_FILE, JSON.stringify(manifest, null, 2));
        zip.file(EXPORT_SNAPSHOT_FILE, JSON.stringify(snapshotResult.snapshot, null, 2));
        if (eventsPayload) {
          zip.file(EXPORT_EVENTS_FILE, eventsPayload);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        const timestamp = buildExportTimestamp();
        downloadBlob(blob, `mazemaze-piggy-bank-${scope}-export-${timestamp}.zip`);
        setExportState({ status: "success", message: `Downloaded ${scope} export.` });
      } catch (err) {
        if (isStorageNotFound(err)) {
          setExportState({ status: "error", message: "No snapshot found to export." });
          return;
        }
        setExportState({ status: "error", message: getUserMessage(err) });
      }
    },
    [activeProviderId, isSignedIn, storage, sharedRoot],
  );

  const handleImportFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    setImportState({ status: "working", message: "Reading import file..." });
    try {
      const zip = await JSZip.loadAsync(file);
      const manifestEntry = zip.file(EXPORT_MANIFEST_FILE);
      if (!manifestEntry) {
        throw new Error("manifest.json is missing.");
      }
      const manifestRaw = await manifestEntry.async("text");
      const manifest = parseExportManifest(JSON.parse(manifestRaw) as unknown);
      const snapshotEntry = zip.file(manifest.snapshotFile);
      if (!snapshotEntry) {
        throw new Error("Snapshot file is missing.");
      }
      const snapshotContent = await snapshotEntry.async("text");
      const snapshot = parseSnapshot(snapshotContent);
      let eventChunks: EventChunk[] = [];
      if (manifest.eventsFile) {
        const eventsEntry = zip.file(manifest.eventsFile);
        if (!eventsEntry) {
          throw new Error("Event log file is missing.");
        }
        const eventsContent = await eventsEntry.async("text");
        eventChunks = parseEventArchive(eventsContent);
      }
      setImportPayload({ manifest, snapshot, eventChunks });
      setImportFileName(file.name);
      setImportState({ status: "success", message: "Import file is ready." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read the import file.";
      setImportPayload(null);
      setImportFileName(null);
      setImportState({ status: "error", message });
    }
  }, []);

  const handlePickImportFile = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleApplyImport = useCallback(async () => {
    if (!importPayload) {
      setImportState({ status: "error", message: "Choose an export file first." });
      return;
    }
    if (!isSignedIn) {
      setImportState({ status: "error", message: "Sign in to import data." });
      return;
    }
    if (!data.isOnline) {
      setImportState({ status: "error", message: "Reconnect to import data." });
      return;
    }
    if (importPayload.manifest.scope === "shared" && !sharedRoot) {
      setImportState({ status: "error", message: "Select a shared workspace first." });
      return;
    }
    setImportState({ status: "working", message: "Applying import..." });
    try {
      const sortedChunks = [...importPayload.eventChunks].sort(
        (left, right) => left.chunkId - right.chunkId,
      );
      if (importPayload.manifest.scope === "personal") {
        await storage.writePersonalSnapshot(importPayload.snapshot);
        await storage.deleteAllEventChunks();
        if (sortedChunks.length > 0) {
          await storage.ensureEventsFolder();
          for (const chunk of sortedChunks) {
            await storage.writeEventChunk(chunk.chunkId, serializeEventChunk(chunk), {
              assumeMissing: true,
            });
          }
        }
        await clearSnapshotCache();
        await data.refresh();
        setImportState({
          status: "success",
          message: "Import applied. Personal data refreshed.",
        });
      } else {
        const targetRoot = sharedRoot as SharedRootReference;
        await storage.writeSharedSnapshot(targetRoot, importPayload.snapshot);
        await storage.deleteAllSharedEventChunks(targetRoot);
        if (sortedChunks.length > 0) {
          await storage.ensureSharedEventsFolder(targetRoot);
          for (const chunk of sortedChunks) {
            await storage.writeSharedEventChunk(
              targetRoot,
              chunk.chunkId,
              serializeEventChunk(chunk),
              { assumeMissing: true },
            );
          }
        }
        await clearSnapshotCache();
        setImportState({
          status: "success",
          message: "Import applied. Open the shared workspace to review.",
        });
      }
    } catch (err) {
      setImportState({ status: "error", message: getUserMessage(err) });
    }
  }, [data, importPayload, isSignedIn, sharedRoot, storage]);

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
        providerId: activeProviderId,
        sharedId: target.sharedId,
        driveId: target.driveId ?? "",
        itemId: target.itemId ?? "",
        name: target.name,
        webUrl: target.webUrl,
      });
    },
    [activeProviderId, setSelection, sharedRoots],
  );

  const handleCreateSharedFolder = useCallback(async () => {
    if (!isSignedIn) {
      setSharedState({ status: "error", message: "Sign in to create shared workspaces." });
      return;
    }
    if (!data.isOnline) {
      setSharedState({ status: "error", message: "Reconnect to create shared workspaces." });
      return;
    }
    if (!storage.capabilities.supportsShared) {
      setSharedState({ status: "error", message: "Shared workspaces are unavailable." });
      return;
    }
    const normalized = createFolderName.trim();
    if (!normalized) {
      setSharedState({ status: "error", message: "Enter a workspace name." });
      return;
    }
    setSharedState({ status: "working", message: "Creating shared workspace..." });
    try {
      const created = await storage.createSharedFolder(normalized);
      setSharedRoots((prev) => mergeSharedRoots([...prev, created]));
      setCreateFolderName("");
      setCreateDialogOpen(false);
      setSharedState({ status: "success", message: `Created "${created.name}".` });
    } catch (err) {
      setSharedState({ status: "error", message: getUserMessage(err) });
    }
  }, [createFolderName, data.isOnline, isSignedIn, storage]);

  const handleCreateShareLink = useCallback(async () => {
    if (!isSignedIn) {
      setShareLinkState({ status: "error", message: "Sign in to create share links." });
      return;
    }
    if (!data.isOnline) {
      setShareLinkState({ status: "error", message: "Reconnect to create share links." });
      return;
    }
    if (!storage.capabilities.supportsShareLinks) {
      setShareLinkState({ status: "error", message: "Share links are unavailable." });
      return;
    }
    if (!sharedRoot) {
      setShareLinkState({ status: "error", message: "Select a shared workspace first." });
      return;
    }
    setShareLinkState({ status: "working", message: "Creating share link..." });
    try {
      const result = await storage.createShareLink(sharedRoot, shareLinkPermission);
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
  }, [data.isOnline, isSignedIn, shareLinkPermission, sharedRoot, storage]);

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
    if (!isHydrated) {
      setCopyPathMessage("Location is still loading.");
      return;
    }
    const copied = await copyToClipboard(storage.appRootLabel);
    setCopyPathMessage(copied ? "Path copied." : "Copy failed. Copy the path manually.");
  }, [isHydrated, storage.appRootLabel]);

  const handleOpenInDrive = useCallback(async () => {
    if (selectedSharedWebUrl) {
      window.open(selectedSharedWebUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!sharedRoot) {
      setShareLinkState({ status: "error", message: "Select a shared workspace first." });
      return;
    }
    setShareLinkState({
      status: "working",
      message: `Resolving ${storage.label} link...`,
    });
    try {
      const info = await storage.getSharedRootInfo(sharedRoot);
      if (!info.webUrl) {
        setShareLinkState({ status: "error", message: "Could not resolve a link." });
        return;
      }
      window.open(info.webUrl, "_blank", "noopener,noreferrer");
      setShareLinkState({ status: "success", message: `Opened in ${storage.label}.` });
    } catch (err) {
      setShareLinkState({ status: "error", message: getUserMessage(err) });
    }
  }, [selectedSharedWebUrl, sharedRoot, storage]);

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
      await storage.deleteAppCloudData();
      await clearSnapshotCacheForProvider(activeProviderId);
      clearSelection();
      setDangerState({ status: "success", message: "Cloud data deleted. Reloading..." });
      window.location.assign("/dashboard");
    } catch (err) {
      setDangerState({ status: "error", message: getUserMessage(err) });
    }
  }, [activeProviderId, clearSelection, isSignedIn, storage]);

  const resolveProviderAccountLabel = useCallback(
    (providerId: CloudProviderId) =>
      providerSnapshots[providerId].account?.name ??
      providerSnapshots[providerId].account?.email ??
      "Unknown",
    [providerSnapshots],
  );

  const handleProviderSignIn = useCallback(
    async (providerId: CloudProviderId, options?: { prompt?: string }) => {
      setActiveProviderId(providerId);
      setSwitchState({ status: "idle", message: null });
      try {
        await signIn(providerId, options);
      } catch (err) {
        setSwitchState({ status: "error", message: getUserMessage(err) });
      }
    },
    [setActiveProviderId, signIn],
  );

  const checkProviderAvailability = useCallback(
    async (providerId: CloudProviderId) => {
      const provider = providerSnapshots[providerId];
      if (provider.status !== "signed_in") {
        return {
          status: "not_signed_in" as const,
          statusNote:
            provider.status === "error"
              ? (provider.error ?? "Sign-in unavailable.")
              : provider.status === "loading"
                ? "Checking sign-in status..."
                : null,
        };
      }
      if (!data.isOnline) {
        return { status: "available" as const, statusNote: "Status unknown while offline." };
      }
      const targetStorage = storageByProvider[providerId];
      try {
        await targetStorage.readPersonalSnapshot();
        return { status: "available" as const, statusNote: null };
      } catch (err) {
        if (!isStorageNotFound(err)) {
          return { status: "available" as const, statusNote: "Status check failed." };
        }
        try {
          const chunkIds = await targetStorage.listEventChunkIds();
          if (chunkIds.length === 0) {
            return { status: "empty" as const, statusNote: null };
          }
          return { status: "available" as const, statusNote: null };
        } catch (chunkErr) {
          if (isStorageNotFound(chunkErr)) {
            return { status: "empty" as const, statusNote: null };
          }
          return { status: "available" as const, statusNote: "Status check failed." };
        }
      }
    },
    [data.isOnline, providerSnapshots, storageByProvider],
  );

  const refreshSwitchCandidates = useCallback(async () => {
    setSwitchLoading(true);
    setSwitchState({ status: "idle", message: null });
    try {
      const candidates = await Promise.all(
        (["onedrive", "gdrive"] as CloudProviderId[]).map(async (providerId) => {
          const availability = await checkProviderAvailability(providerId);
          return {
            providerId,
            label: storageByProvider[providerId].label,
            description: PROVIDER_DESCRIPTIONS[providerId],
            status: availability.status,
            statusNote: availability.statusNote ?? undefined,
            accountLabel:
              providerSnapshots[providerId].status === "signed_in"
                ? resolveProviderAccountLabel(providerId)
                : undefined,
            isActive: providerId === activeProviderId,
          };
        }),
      );
      setSwitchCandidates(candidates);
    } catch (err) {
      setSwitchState({ status: "error", message: getUserMessage(err) });
    } finally {
      setSwitchLoading(false);
    }
  }, [
    activeProviderId,
    checkProviderAvailability,
    providerSnapshots,
    resolveProviderAccountLabel,
    storageByProvider,
  ]);

  const openSwitchDialog = useCallback(() => {
    setSwitchDialogOpen(true);
    void refreshSwitchCandidates();
  }, [refreshSwitchCandidates]);

  const closeSwitchDialog = useCallback(() => {
    if (isSwitchWorking) {
      return;
    }
    setSwitchDialogOpen(false);
    setSwitchState({ status: "idle", message: null });
  }, [isSwitchWorking]);

  const handleSwitchProvider = useCallback(
    (providerId: CloudProviderId) => {
      setActiveProviderId(providerId);
      setSwitchState({
        status: "success",
        message: `Switched to ${storageByProvider[providerId].label}.`,
      });
      setSwitchDialogOpen(false);
    },
    [setActiveProviderId, storageByProvider],
  );

  const openMoveDialog = useCallback(
    (providerId: CloudProviderId) => {
      setMoveTargetProviderId(providerId);
      setMoveStep(1);
      setMoveAcknowledge(false);
      setMoveBackupConfirm(false);
      setMoveConfirmText("");
      setMoveDialogOpen(true);
      setSwitchDialogOpen(false);
      setMoveProgress(null);
    },
    [setSwitchDialogOpen],
  );

  const closeMoveDialog = useCallback(() => {
    if (isSwitchWorking) {
      return;
    }
    setMoveDialogOpen(false);
    setMoveStep(1);
    setMoveAcknowledge(false);
    setMoveBackupConfirm(false);
    setMoveConfirmText("");
    setMoveTargetProviderId(null);
    setMoveProgress(null);
  }, [isSwitchWorking]);

  const handleMoveData = useCallback(async () => {
    if (!moveTargetProviderId) {
      return;
    }
    if (!isSignedIn) {
      setSwitchState({ status: "error", message: "Sign in to move data." });
      return;
    }
    if (!data.isOnline) {
      setSwitchState({ status: "error", message: "Reconnect to move data." });
      return;
    }
    if (moveTargetProviderId === activeProviderId) {
      setSwitchState({ status: "error", message: "This provider is already active." });
      return;
    }
    if (providers[moveTargetProviderId].status !== "signed_in") {
      setSwitchState({ status: "error", message: "Sign in to the target provider first." });
      return;
    }
    const targetLabel = storageByProvider[moveTargetProviderId].label;
    const sourceLabel = storageByProvider[activeProviderId].label;
    setSwitchState({
      status: "working",
      message: `Moving data to ${targetLabel}...`,
    });
    const sourceStorage = storageByProvider[activeProviderId];
    const targetStorage = storageByProvider[moveTargetProviderId];
    try {
      setMoveProgress({ phase: "snapshot", message: "Reading source snapshot..." });
      const snapshotResult = await sourceStorage.readPersonalSnapshot();
      let chunkIds: number[] = [];
      try {
        chunkIds = await sourceStorage.listEventChunkIds();
      } catch (err) {
        if (!isStorageNotFound(err)) {
          throw err;
        }
      }
      const sortedChunkIds = [...chunkIds].sort((a, b) => a - b);
      setMoveProgress({ phase: "prepare", message: "Preparing destination..." });
      await targetStorage.deleteAllEventChunks();
      await targetStorage.ensureEventsFolder();
      setMoveProgress({ phase: "snapshot", message: `Copying snapshot to ${targetLabel}...` });
      await targetStorage.writePersonalSnapshot(snapshotResult.snapshot);
      if (sortedChunkIds.length > 0) {
        setMoveProgress({
          phase: "events",
          message: `Copying ${sortedChunkIds.length} event chunks...`,
          current: 0,
          total: sortedChunkIds.length,
        });
        for (let index = 0; index < sortedChunkIds.length; index += 1) {
          const chunkId = sortedChunkIds[index];
          const content = await sourceStorage.readEventChunk(chunkId);
          await targetStorage.writeEventChunk(chunkId, content, { assumeMissing: true });
          setMoveProgress((prev) =>
            prev
              ? {
                  ...prev,
                  current: index + 1,
                }
              : prev,
          );
        }
      }
      setMoveProgress({ phase: "cleanup", message: `Removing data from ${sourceLabel}...` });
      await sourceStorage.deleteAppCloudData();
      clearSelection(activeProviderId);
      await clearSnapshotCache();
      setActiveProviderId(moveTargetProviderId);
      setMoveDialogOpen(false);
      setSwitchDialogOpen(false);
      setMoveProgress(null);
      setSwitchState({
        status: "success",
        message: `Moved data to ${targetLabel}.`,
      });
    } catch (err) {
      setMoveProgress(null);
      if (isStorageNotFound(err)) {
        setSwitchState({ status: "error", message: "No personal data found to move." });
        return;
      }
      setSwitchState({ status: "error", message: getUserMessage(err) });
    }
  }, [
    activeProviderId,
    clearSelection,
    data.isOnline,
    isSignedIn,
    moveTargetProviderId,
    providers,
    setActiveProviderId,
    storageByProvider,
  ]);

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
      setIsHydrated(true);
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
    if (!switchDialogOpen || moveDialogOpen || isSwitchWorking) {
      return;
    }
    void refreshSwitchCandidates();
  }, [data.isOnline, isSwitchWorking, moveDialogOpen, refreshSwitchCandidates, switchDialogOpen]);

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
        const info = await storage.getSharedRootInfo(sharedRoot);
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
  }, [isSignedIn, sharedRoot, storage]);

  const shareLinkDetail =
    typeof shareLinkState.payload === "string" ? shareLinkState.payload : null;

  const renderProviderSignInButton = (
    providerId: CloudProviderId,
    options?: { prompt?: string },
  ) => {
    const provider = providers[providerId];
    const isLoading = provider.status === "loading";
    const isDisabled = provider.status === "error" || isLoading;
    return (
      <button
        type="button"
        className={`provider-signin-button provider-signin-button-${providerId}`}
        onClick={() => void handleProviderSignIn(providerId, options)}
        disabled={isDisabled}
        aria-label={PROVIDER_SIGNIN_LABELS[providerId]}
      >
        <span className="provider-signin-logo" aria-hidden>
          {providerId === "onedrive" ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <rect x="1" y="1" width="10" height="10" fill="#F25022" />
              <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
              <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
              <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
            </svg>
          ) : (
            <svg viewBox="0 0 18 18" aria-hidden>
              <path
                fill="#4285F4"
                d="M17.64 9.2045c0-.638-.0573-1.251-.1636-1.836H9v3.476h4.8445c-.2082 1.121-.8364 2.071-1.7764 2.709v2.25h2.8845c1.689-1.554 2.688-3.846 2.688-6.282z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.806 5.96-2.188l-2.8845-2.25c-.806.54-1.836.86-3.076.86-2.364 0-4.364-1.596-5.086-3.74H0.93v2.332C2.412 15.978 5.47 18 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.914 10.682c-.18-.54-.283-1.116-.283-1.682s.103-1.142.283-1.682V4.986H0.93C.332 6.186 0 7.54 0 9s.332 2.814.93 4.014l2.984-2.332z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.508.454 3.44 1.346l2.58-2.58C13.46.89 11.43 0 9 0 5.47 0 2.412 2.022.93 4.986l2.984 2.332C4.636 5.176 6.636 3.58 9 3.58z"
              />
            </svg>
          )}
        </span>
        <span className="provider-signin-text">{PROVIDER_SIGNIN_LABELS[providerId]}</span>
      </button>
    );
  };

  const renderSignInStorageBody = () => {
    if (!anySignedIn) {
      return (
        <>
          <h3>Choose where to save</h3>
          <p className="app-muted">Sign in to start saving your data in the cloud.</p>
          <div className="settings-provider-grid">
            {(["onedrive", "gdrive"] as CloudProviderId[]).map((providerId) => {
              const provider = providers[providerId];
              const isLoading = provider.status === "loading";
              return (
                <div key={providerId} className="settings-provider-card">
                  <div className="settings-provider-card-header">
                    <strong>{storageByProvider[providerId].label}</strong>
                    {isLoading ? <Spinner size="tiny" /> : null}
                  </div>
                  <p className="app-muted">{PROVIDER_DESCRIPTIONS[providerId]}</p>
                  {renderProviderSignInButton(providerId)}
                  {provider.status === "error" ? (
                    <p className="app-muted settings-help-text">
                      {provider.error ?? "Sign-in is unavailable."}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {switchState.message ? (
            <div
              className={`app-alert ${switchState.status === "error" ? "app-alert-error" : ""}`}
              role="status"
            >
              <Text>{switchState.message}</Text>
            </div>
          ) : null}
        </>
      );
    }

    const workspaceLabel = effectiveSelection ? `Shared · ${effectiveSelection.name}` : "Personal";
    const connectedProviderId =
      activeProvider.status === "signed_in"
        ? activeProviderId
        : providers.onedrive.status === "signed_in"
          ? "onedrive"
          : providers.gdrive.status === "signed_in"
            ? "gdrive"
            : activeProviderId;
    const connectedStorage = storageByProvider[connectedProviderId];
    const connectedAccountLabel = resolveProviderAccountLabel(connectedProviderId);
    const connectedProvider = providers[connectedProviderId];
    return (
      <>
        <div className="settings-row-grid" role="list">
          <div className="settings-row" role="listitem">
            <span className="app-muted">Connected to</span>
            <strong>{connectedStorage.label}</strong>
          </div>
          <div className="settings-row" role="listitem">
            <span className="app-muted">Signed in as</span>
            <strong>{connectedAccountLabel}</strong>
          </div>
          <div className="settings-row" role="listitem">
            <span className="app-muted">Workspace</span>
            <strong>{workspaceLabel}</strong>
          </div>
        </div>
        {effectiveSelection ? (
          <p className="app-muted settings-help-text">Access: {sharedAccessLabel}</p>
        ) : null}
        <div className="app-actions" style={{ marginTop: 12 }}>
          <Button
            onClick={() => void signOut(connectedProviderId)}
            disabled={connectedProvider.status === "loading" || isSwitchWorking}
          >
            Sign out
          </Button>
          <Button appearance="primary" onClick={openSwitchDialog} disabled={isSwitchWorking}>
            Switch…
          </Button>
          {connectedProvider.status === "loading" ? <Spinner size="tiny" /> : null}
        </div>
        {switchState.message ? (
          <div
            className={`app-alert ${switchState.status === "error" ? "app-alert-error" : ""}`}
            role="status"
          >
            <Text>{switchState.message}</Text>
          </div>
        ) : null}
      </>
    );
  };

  const resolveRootNoticeLabel = (notice: RootFolderNotice): string => {
    switch (notice.scope) {
      case "app":
        return "App folder";
      case "personal":
        return "Personal folder";
      case "shared":
        return "Shared folder";
      default:
        return "Folder";
    }
  };

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
      {rootNotices.length > 0 ? (
        <div className="app-alert" role="status">
          <Text>
            Notice: A folder name was changed. Sync will continue, but for backups use Export in
            Data &amp; portability.
          </Text>
          <div className="settings-row-grid" role="list" style={{ marginTop: 8 }}>
            {rootNotices.map((notice) => (
              <div
                className="settings-row"
                role="listitem"
                key={`${notice.scope}-${notice.actualName}`}
              >
                <span className="app-muted">{resolveRootNoticeLabel(notice)}</span>
                <strong>
                  {notice.actualName} (expected {notice.expectedName})
                </strong>
              </div>
            ))}
          </div>
          <p className="app-muted settings-help-text" style={{ marginTop: 8 }}>
            <a href="#data-portability">Open Data &amp; portability</a>
          </p>
        </div>
      ) : null}
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

  const renderWorkspaceBody = () => (
    <>
      <p className="app-muted">Manage shared workspace selection and access in one place.</p>
      <div className="settings-subsection">
        <h3>Shared workspace</h3>
        <p className="app-muted">Select or create the shared workspace used by this app.</p>
        <div className="settings-row-grid" role="list">
          <div className="settings-row" role="listitem">
            <span className="app-muted">Selected workspace</span>
            <strong>
              {effectiveSelection ? effectiveSelection.name : "No shared workspace selected"}
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
            <span className="app-muted">Available workspaces</span>
            <strong>{sharedRoots.length}</strong>
          </div>
        </div>
        <div className="settings-location">
          <span className="app-muted">Location</span>
          <div className="settings-location-row">
            <span className="settings-truncate" title={appRootLabel}>
              {appRootLabel}
            </span>
            <Button onClick={() => void handleCopySharedPath()} disabled={!isHydrated}>
              Copy path
            </Button>
          </div>
          {copyPathMessage ? (
            <p className="app-muted settings-help-text">{copyPathMessage}</p>
          ) : null}
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="app-muted" htmlFor="settings-shared-folder">
            Shared workspace
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
            Create shared workspace…
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
          Creating a workspace doesn&apos;t share it automatically.
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
        <p className="app-muted">Create a share link for the selected workspace.</p>
        <div className="settings-field">
          <span className="app-muted">Access type</span>
          <RadioGroup
            value={shareLinkPermission}
            onChange={(_, radioData) =>
              setShareLinkPermission(radioData.value as ShareLinkPermission)
            }
            aria-label="Share link access type"
            className="settings-access-type"
            name={SHARE_LINK_RADIO_NAME}
          >
            <Radio id={SHARE_LINK_RADIO_VIEW_ID} value="view" label="View" />
            <Radio id={SHARE_LINK_RADIO_EDIT_ID} value="edit" label="Edit" />
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
                <Button onClick={() => void handleOpenInDrive()} disabled={isShareLinkWorking}>
                  Open in {storageLabel}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  const renderDataPortabilityBody = () => (
    <>
      <p className="app-muted">
        Export or import a zip archive containing snapshots and event logs.
      </p>
      <div className="settings-subsection">
        <h3>Export</h3>
        <p className="app-muted">Download a zip archive of your cloud data.</p>
        <div className="app-actions">
          <Button
            onClick={() => void handleExportArchive("personal")}
            disabled={!isSignedIn || isExportWorking}
          >
            Export personal data
          </Button>
          <Button
            onClick={() => void handleExportArchive("shared")}
            disabled={!isSignedIn || isExportWorking || !sharedRoot}
          >
            Export shared data
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
      <div className="settings-subsection">
        <h3>Import</h3>
        <p className="app-muted">
          Import a zip archive exported from Mazemaze Piggy Bank. This overwrites existing data.
        </p>
        <div className="settings-import-row">
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            onChange={handleImportFileChange}
            className="settings-file-input"
            aria-label="Import file"
          />
          <Button onClick={handlePickImportFile} disabled={isImportWorking}>
            Choose file
          </Button>
          <span className="app-muted settings-import-filename">
            {importFileName ?? "No file selected"}
          </span>
        </div>
        {importSummary ? (
          <div className="settings-import-preview">
            <div className="settings-row-grid" role="list">
              <div className="settings-row" role="listitem">
                <span className="app-muted">Scope</span>
                <strong>{importSummary.scope === "personal" ? "Personal" : "Shared"}</strong>
              </div>
              <div className="settings-row" role="listitem">
                <span className="app-muted">Snapshot version</span>
                <strong>{importSummary.snapshotVersion}</strong>
              </div>
              <div className="settings-row" role="listitem">
                <span className="app-muted">Snapshot updated</span>
                <strong>{formatAbsoluteTimestamp(importSummary.snapshotUpdatedAt)}</strong>
              </div>
              <div className="settings-row" role="listitem">
                <span className="app-muted">Event logs</span>
                <strong>
                  {importSummary.eventCount} events · {importSummary.chunkCount} chunks
                </strong>
              </div>
              <div className="settings-row" role="listitem">
                <span className="app-muted">Exported at</span>
                <strong>{formatAbsoluteTimestamp(importSummary.createdAt)}</strong>
              </div>
              {importSummary.provider ? (
                <div className="settings-row" role="listitem">
                  <span className="app-muted">Exported from</span>
                  <strong>{storageByProvider[importSummary.provider].label}</strong>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="app-actions" style={{ marginTop: 12 }}>
          <Button
            appearance="primary"
            onClick={() => void handleApplyImport()}
            disabled={isImportApplyDisabled || isImportWorking}
          >
            Apply import
          </Button>
          {isImportWorking ? <Spinner size="tiny" /> : null}
        </div>
        {importApplyDisabledReason ? (
          <p className="app-muted settings-help-text">{importApplyDisabledReason}</p>
        ) : null}
        {importState.message ? (
          <div
            className={`app-alert ${importState.status === "error" ? "app-alert-error" : ""}`}
            role="status"
          >
            <Text>{importState.message}</Text>
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
        name={THEME_RADIO_NAME}
      >
        <Radio id={THEME_RADIO_SYSTEM_ID} value="system" label="System" />
        <Radio id={THEME_RADIO_LIGHT_ID} value="light" label="Light" />
        <Radio id={THEME_RADIO_DARK_ID} value="dark" label="Dark" />
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
          <h3>Storage checks</h3>
          <p className="app-muted">
            Run low-level checks against the app folder in {storageLabel}.
          </p>
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
      </div>
    </details>
  );

  const renderDangerBody = () => (
    <>
      <p className="app-muted">
        Delete cloud data removes the app folder content under your configured app root in{" "}
        {storageLabel}.
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
      case "sign-in-storage":
        return renderSignInStorageBody();
      case "connection-health":
        return renderConnectionHealthBody();
      case "workspace":
        return renderWorkspaceBody();
      case "data-portability":
        return renderDataPortabilityBody();
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

      {switchDialogOpen ? (
        <div className="settings-modal-overlay" onClick={closeSwitchDialog}>
          <div
            className="settings-modal settings-switch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-storage-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="switch-storage-title">Switch storage</h3>
            <p className="app-muted">
              Open or move your personal data across OneDrive and Google Drive.
            </p>
            {switchLoading ? <p className="app-muted">Loading providers...</p> : null}
            <div className="settings-switch-list">
              {switchCandidates.map((candidate) => {
                const statusLabel =
                  candidate.status === "available"
                    ? "Available"
                    : candidate.status === "empty"
                      ? "Empty"
                      : "Not signed in";
                const isActive = candidate.isActive;
                const openLabel =
                  candidate.status === "empty" ? "Create" : isActive ? "Current" : "Open";
                return (
                  <div
                    key={candidate.providerId}
                    className={`settings-switch-card ${isActive ? "settings-switch-card-active" : ""}`}
                  >
                    <div className="settings-switch-card-header">
                      <div>
                        <strong>{candidate.label}</strong>
                        <div className="app-muted">{candidate.accountLabel ?? "Not signed in"}</div>
                      </div>
                      <span className="settings-chip">{statusLabel}</span>
                    </div>
                    <p className="app-muted">{candidate.description}</p>
                    {candidate.statusNote ? (
                      <p className="app-muted settings-help-text">{candidate.statusNote}</p>
                    ) : null}
                    <div className="app-actions">
                      {candidate.status === "not_signed_in" ? (
                        renderProviderSignInButton(candidate.providerId)
                      ) : (
                        <>
                          <Button
                            appearance="primary"
                            onClick={() => handleSwitchProvider(candidate.providerId)}
                            disabled={isSwitchWorking || isActive}
                          >
                            {openLabel}
                          </Button>
                          <Button
                            onClick={() => openMoveDialog(candidate.providerId)}
                            disabled={isSwitchWorking || isActive}
                          >
                            Move data…
                          </Button>
                          <Button
                            onClick={() =>
                              void handleProviderSignIn(candidate.providerId, {
                                prompt: "select_account",
                              })
                            }
                            disabled={isSwitchWorking}
                          >
                            Switch account
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {switchState.message ? (
              <div
                className={`app-alert ${switchState.status === "error" ? "app-alert-error" : ""}`}
                role="status"
              >
                <Text>{switchState.message}</Text>
              </div>
            ) : null}
            <div className="app-actions" style={{ marginTop: 16 }}>
              <Button onClick={closeSwitchDialog} disabled={isSwitchWorking}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {moveDialogOpen && moveTargetProviderId ? (
        <div className="settings-modal-overlay" onClick={closeMoveDialog}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-data-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="move-data-title">
              Move data to {storageByProvider[moveTargetProviderId].label}
            </h3>
            {moveStep === 1 ? (
              <>
                <p className="app-muted">
                  This copies your personal data from {storageByProvider[activeProviderId].label} to{" "}
                  {storageByProvider[moveTargetProviderId].label} and then deletes the original app
                  folder content in {storageByProvider[activeProviderId].label}. Existing data in
                  the destination will be overwritten. Shared workspaces in the source provider will
                  also be removed.
                </p>
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={moveAcknowledge}
                    onChange={(event) => setMoveAcknowledge(event.target.checked)}
                  />
                  <span>I understand this will overwrite data in the destination.</span>
                </label>
                <label className="settings-checkbox-row">
                  <input
                    type="checkbox"
                    checked={moveBackupConfirm}
                    onChange={(event) => setMoveBackupConfirm(event.target.checked)}
                  />
                  <span>I have a backup of my data.</span>
                </label>
                <div className="app-actions" style={{ marginTop: 16 }}>
                  <Button onClick={closeMoveDialog} disabled={isSwitchWorking}>
                    Cancel
                  </Button>
                  <Button
                    appearance="primary"
                    disabled={!moveAcknowledge || !moveBackupConfirm || isSwitchWorking}
                    onClick={() => setMoveStep(2)}
                  >
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="app-muted">Type MOVE to confirm.</p>
                <input
                  className="settings-text-input"
                  value={moveConfirmText}
                  onChange={(event) => setMoveConfirmText(event.target.value)}
                  autoFocus
                />
                <div className="app-actions" style={{ marginTop: 16 }}>
                  <Button onClick={() => setMoveStep(1)} disabled={isSwitchWorking}>
                    Back
                  </Button>
                  <Button
                    appearance="primary"
                    disabled={moveConfirmText !== "MOVE" || isSwitchWorking}
                    onClick={() => void handleMoveData()}
                  >
                    Move data
                  </Button>
                </div>
                {isSwitchWorking && moveProgress ? (
                  <div className="section-stack" style={{ marginTop: 12 }}>
                    <p className="app-muted">{moveProgress.message}</p>
                    {moveProgress.total && moveProgress.total > 0 ? (
                      <>
                        <progress
                          value={moveProgress.current ?? 0}
                          max={moveProgress.total}
                          aria-label="Move progress"
                          style={{ width: "100%" }}
                        />
                        <p className="app-muted">
                          {moveProgress.current ?? 0} / {moveProgress.total}
                        </p>
                      </>
                    ) : (
                      <Spinner size="tiny" />
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
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
            <h3 id="create-shared-folder-title">Create shared workspace</h3>
            <p className="app-muted">
              Enter a workspace name. The workspace is not shared automatically.
            </p>
            <label className="app-muted" htmlFor="create-shared-folder-input">
              Workspace name
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
                Create workspace
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
                  {storageLabel}.
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
