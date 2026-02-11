"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useStorageProviderContext } from "@/components/StorageProviderContext";
import {
  formatStorageError,
  isStorageNetworkError,
  isStorageNotFound,
  isStoragePermissionScopeError,
  isStoragePreconditionFailed,
} from "@/lib/storage/storageErrors";
import {
  assignEventVersions,
  buildEventChunks,
  parseEventChunk,
  serializeEventChunk,
  type PendingEvent,
} from "@/lib/persistence/eventChunk";
import { createHistoryLoader, type HistoryPage } from "@/lib/persistence/history";
import {
  createAccount as createAccountDomain,
  createAllocation as createAllocationDomain,
  createGoal as createGoalDomain,
  createPosition as createPositionDomain,
  deleteAccount as deleteAccountDomain,
  deleteAllocation as deleteAllocationDomain,
  deleteGoal as deleteGoalDomain,
  deletePosition as deletePositionDomain,
  reduceAllocations as reduceAllocationsDomain,
  repairStateOnLoad,
  spendGoal as spendGoalDomain,
  undoSpend as undoSpendDomain,
  updateAccount as updateAccountDomain,
  updateAllocation as updateAllocationDomain,
  updateGoal as updateGoalDomain,
  updatePosition as updatePositionDomain,
  type AllocationNotice,
  type DomainActionResult,
} from "@/lib/persistence/domain";
import { createId } from "@/lib/persistence/id";
import { createEmptySnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import { readSnapshotCache, writeSnapshotCache } from "@/lib/persistence/snapshotCache";
import { buildPersonalSyncSignalKey, upsertSyncSignal } from "@/lib/persistence/syncSignalStore";
import { useOnlineStatus } from "@/lib/persistence/useOnlineStatus";
import type { Goal, NormalizedState, Position } from "@/lib/persistence/types";
import { getDeviceId } from "@/lib/lease/deviceId";
import type { LeaseRecord } from "@/lib/storage/lease";
import { createStorageService } from "@/lib/storage/storageService";
import type {
  DataActivity,
  DataContextValue,
  DataSource,
  DataStatus,
  DomainActionOutcome,
  SaveChangesOutcome,
  SpaceInfo,
} from "@/components/dataContext";
import { canPromptGoogleConsent, markGoogleConsentPrompted } from "@/lib/auth/googleConsent";

const MAX_EVENTS_PER_CHUNK = 500;
const LEASE_DURATION_MS = 90_000;
const LEASE_REFRESH_MS = 60_000;
const LEASE_EDIT_EVENT_TYPES = new Set<string>(["state_repaired"]);

type SnapshotRecord = {
  snapshot: Snapshot;
  etag: string | null;
};

type QueuedChunkWrite = {
  chunkId: number;
  content: string;
};

const PersonalDataContext = createContext<DataContextValue | null>(null);

const formatGraphError = (error: unknown): string => formatStorageError(error);

const buildEventMeta = () => ({
  eventId: createId(),
  createdAt: new Date().toISOString(),
});

const buildPartialFailureMessage = (pendingChunkCount: number): string => {
  const noun = pendingChunkCount === 1 ? "chunk" : "chunks";
  return `Save partially failed: ${pendingChunkCount} history ${noun} still need upload. Retry is required.`;
};

const buildPartialFailureDetail = (pendingChunkCount: number, cause: string): string =>
  `${buildPartialFailureMessage(pendingChunkCount)} Last error: ${cause}`;

const withTimeout = async <T,>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      task,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("History request timed out. Please retry."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export function PersonalDataProvider({ children }: { children: React.ReactNode }) {
  const { providers, getAccessToken } = useAuth();
  const { activeProviderId } = useStorageProviderContext();
  const activeProvider = providers[activeProviderId];
  const isOnline = useOnlineStatus();
  const isSignedIn = activeProvider.status === "signed_in";
  const account = activeProvider.account;
  const canWrite = true;
  const readOnlyReason = null;

  const space = useMemo<SpaceInfo>(
    () => ({
      scope: "personal",
      label: "Personal",
    }),
    [],
  );

  const [status, setStatus] = useState<DataStatus>("idle");
  const [activity, setActivity] = useState<DataActivity>("idle");
  const [source, setSource] = useState<DataSource>("empty");
  const [snapshotRecord, setSnapshotRecord] = useState<SnapshotRecord | null>(null);
  const [draftState, setDraftState] = useState<NormalizedState | null>(null);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allocationNotice, setAllocationNotice] = useState<AllocationNotice | null>(null);
  const [latestEvent, setLatestEvent] = useState<PendingEvent | null>(null);
  const [savedLatestEvent, setSavedLatestEvent] = useState<PendingEvent | null>(null);
  const [lease, setLease] = useState<LeaseRecord | null>(null);
  const [leaseError, setLeaseError] = useState<string | null>(null);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [retryQueueCount, setRetryQueueCount] = useState(0);
  const pendingEventsRef = useRef<PendingEvent[]>([]);
  const pendingHistoryChunksRef = useRef<QueuedChunkWrite[]>([]);
  const hasLocalDataRef = useRef(false);
  const snapshotRecordRef = useRef<SnapshotRecord | null>(null);
  const revalidateSequenceRef = useRef(0);
  const loadFromRemoteRef = useRef<((options?: { background?: boolean }) => Promise<void>) | null>(
    null,
  );
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  const tokenProvider = useCallback(
    (scopes: string[]) => getAccessToken(activeProviderId, scopes),
    [activeProviderId, getAccessToken],
  );
  const storage = useMemo(
    () => createStorageService(activeProviderId, tokenProvider),
    [activeProviderId, tokenProvider],
  );
  const historyLoader = useMemo(
    () =>
      createHistoryLoader({
        listChunkIds: () => storage.listEventChunkIds(),
        readChunk: (chunkId) => storage.readEventChunk(chunkId),
      }),
    [storage],
  );

  const applySnapshot = useCallback(
    (
      snapshot: Snapshot,
      etag: string | null,
      sourceType: DataSource,
      notice: string | null,
      loadedLatestEvent: PendingEvent | null,
    ) => {
      const repair = repairStateOnLoad(snapshot.stateJson, buildEventMeta());
      setSnapshotRecord({ snapshot, etag });
      setDraftState(repair.nextState);
      setPendingEvents(repair.events);
      setAllocationNotice(repair.notice ?? null);
      setSource(sourceType);
      setStatus("ready");
      const combinedMessage =
        repair.warnings.length > 0
          ? [...repair.warnings, notice].filter(Boolean).join(" ")
          : notice;
      setMessage(combinedMessage ?? null);
      setError(null);
      setLatestEvent(loadedLatestEvent);
      setSavedLatestEvent(loadedLatestEvent);
    },
    [],
  );

  const loadLeaseFromRemote = useCallback(async () => {
    try {
      const result = await storage.readPersonalLease();
      setLease(result);
      setLeaseError(null);
    } catch (err) {
      setLeaseError(formatGraphError(err));
    }
  }, [storage]);

  const loadLatestEventFromRemote = useCallback(async (): Promise<PendingEvent | null> => {
    try {
      const chunkIds = await storage.listEventChunkIds();
      if (chunkIds.length === 0) {
        return null;
      }
      const latestChunkId = Math.max(...chunkIds);
      const content = await storage.readEventChunk(latestChunkId);
      const parsed = parseEventChunk(content);
      const latest = parsed.events[parsed.events.length - 1];
      if (!latest) {
        return null;
      }
      return {
        id: latest.id,
        type: latest.type,
        createdAt: latest.createdAt,
        payload: latest.payload,
      };
    } catch {
      return null;
    }
  }, [storage]);

  const loadFromCache = useCallback(async () => {
    setStatus("loading");
    setActivity("loading");
    try {
      const cacheKey = `personal:${activeProviderId}`;
      const cached =
        (await readSnapshotCache(cacheKey)) ??
        (activeProviderId === "onedrive" ? await readSnapshotCache("personal") : null);
      if (cached) {
        applySnapshot(
          cached.snapshot,
          cached.etag,
          "cache",
          "Loaded cached data.",
          savedLatestEvent,
        );
      } else {
        if (!isOnline) {
          setStatus("error");
          setSource("empty");
          setMessage(null);
          setError("No cached data is available.");
          return;
        }
        setStatus("loading");
        setSource("empty");
        setMessage(null);
        setError(null);
      }
    } catch (err) {
      setStatus("error");
      setSource("empty");
      setMessage(null);
      setError(formatGraphError(err));
    } finally {
      setActivity("idle");
    }
  }, [activeProviderId, applySnapshot, isOnline, savedLatestEvent]);

  const loadFromRemote = useCallback(
    async (options?: { background?: boolean }) => {
      const shouldRunInBackground = Boolean(options?.background && snapshotRecordRef.current);
      const sequence = shouldRunInBackground ? ++revalidateSequenceRef.current : null;
      if (pendingEventsRef.current.length > 0) {
        setMessage("Pending local changes are still processing. Try again shortly.");
        return;
      }
      if (shouldRunInBackground) {
        setIsRevalidating(true);
      } else {
        setStatus("loading");
        setActivity("loading");
      }
      try {
        await storage.ensureAppRoot();
        const result = await storage.readPersonalSnapshot();
        const latest = await loadLatestEventFromRemote();
        if (pendingEventsRef.current.length > 0) {
          setStatus("ready");
          setMessage("Pending local changes are still processing. Try again shortly.");
          return;
        }
        const cacheKey = `personal:${activeProviderId}`;
        applySnapshot(result.snapshot, result.etag, "remote", "Synced from cloud.", latest);
        void loadLeaseFromRemote();
        await writeSnapshotCache({
          key: cacheKey,
          snapshot: result.snapshot,
          etag: result.etag,
          cachedAt: new Date().toISOString(),
        });
      } catch (err) {
        if (
          activeProviderId === "gdrive" &&
          isStoragePermissionScopeError(err) &&
          canPromptGoogleConsent()
        ) {
          markGoogleConsentPrompted();
          try {
            await activeProvider.signIn({ prompt: "consent" });
            await loadFromRemote(options);
            return;
          } catch {
            // Fall through to default error handling.
          }
        }
        if (isStorageNotFound(err)) {
          try {
            const now = new Date().toISOString();
            const emptySnapshot = createEmptySnapshot(now);
            const result = await storage.writePersonalSnapshot(emptySnapshot);
            applySnapshot(
              emptySnapshot,
              result.etag,
              "remote",
              "No snapshot found yet. Add accounts or goals to create your first snapshot.",
              null,
            );
            await writeSnapshotCache({
              key: `personal:${activeProviderId}`,
              snapshot: emptySnapshot,
              etag: result.etag,
              cachedAt: now,
            });
            setActivity("idle");
            return;
          } catch (creationError) {
            setStatus("error");
            setSource("empty");
            setMessage(null);
            setError(formatGraphError(creationError));
            return;
          }
        }
        if (isStorageNetworkError(err)) {
          if (shouldRunInBackground) {
            setMessage("Offline mode. Showing cached data.");
            return;
          }
          await loadFromCache();
          setMessage("Offline mode. Showing cached data.");
          return;
        }
        setStatus("error");
        setSource("empty");
        setMessage(null);
        setError(formatGraphError(err));
      } finally {
        if (shouldRunInBackground) {
          if (sequence === revalidateSequenceRef.current) {
            setIsRevalidating(false);
          }
        } else {
          setActivity("idle");
        }
      }
    },
    [
      activeProviderId,
      activeProvider,
      applySnapshot,
      loadFromCache,
      loadLatestEventFromRemote,
      loadLeaseFromRemote,
      storage,
    ],
  );
  useEffect(() => {
    pendingEventsRef.current = pendingEvents;
  }, [pendingEvents]);

  useEffect(() => {
    hasLocalDataRef.current = Boolean(draftState);
  }, [draftState]);

  useEffect(() => {
    snapshotRecordRef.current = snapshotRecord;
  }, [snapshotRecord]);

  useEffect(() => {
    loadFromRemoteRef.current = loadFromRemote;
  }, [loadFromRemote]);

  const refresh = useCallback(async () => {
    if (!isOnline || !isSignedIn) {
      await loadFromCache();
      return;
    }
    await loadFromRemote({ background: true });
  }, [isOnline, isSignedIn, loadFromCache, loadFromRemote]);

  const discardChanges = useCallback(() => {
    if (!snapshotRecord) {
      return;
    }
    const repair = repairStateOnLoad(snapshotRecord.snapshot.stateJson, buildEventMeta());
    setDraftState(repair.nextState);
    setPendingEvents(repair.events);
    setAllocationNotice(repair.notice ?? null);
    setLatestEvent(savedLatestEvent);
    setMessage("Local pending edits were cleared.");
  }, [savedLatestEvent, snapshotRecord]);

  const loadHistoryPage = useCallback(
    async (input: {
      limit: number;
      cursor?: string | null;
      filter?: { goalId?: string; positionId?: string };
    }): Promise<HistoryPage> => {
      if (!isOnline) {
        throw new Error("History is unavailable offline.");
      }
      if (!isSignedIn) {
        throw new Error("Sign in to load history.");
      }
      return withTimeout(historyLoader(input), 12_000);
    },
    [historyLoader, isOnline, isSignedIn],
  );

  const flushPendingHistoryChunks = useCallback(
    async (
      queue: QueuedChunkWrite[],
    ): Promise<
      { ok: true } | { ok: false; failedQueue: QueuedChunkWrite[]; errorMessage: string }
    > => {
      for (let index = 0; index < queue.length; index += 1) {
        const chunk = queue[index];
        try {
          await storage.writeEventChunk(chunk.chunkId, chunk.content);
        } catch (err) {
          return {
            ok: false,
            failedQueue: queue.slice(index),
            errorMessage: formatGraphError(err),
          };
        }
      }
      return { ok: true };
    },
    [storage],
  );

  const handleConflict = useCallback(async () => {
    await loadFromRemote();
    setMessage(
      "Save failed because the data changed elsewhere. Reloaded the latest data and discarded your edits.",
    );
  }, [loadFromRemote]);

  const saveChanges = useCallback(async (): Promise<SaveChangesOutcome> => {
    if (!isOnline) {
      setMessage("Offline mode is view-only. Please reconnect to save changes.");
      return { ok: false, reason: "offline" };
    }
    if (!isSignedIn) {
      setMessage("Sign in to save changes.");
      return { ok: false, reason: "unauthenticated" };
    }
    if (!snapshotRecord || !draftState) {
      setError("No snapshot is loaded yet.");
      return { ok: false, reason: "no_snapshot" };
    }
    const hasPendingHistoryChunks = pendingHistoryChunksRef.current.length > 0;
    if (pendingEvents.length === 0 && !hasPendingHistoryChunks) {
      setMessage("No pending sync work.");
      return { ok: false, reason: "no_changes" };
    }
    if (pendingEvents.length > 0 && !snapshotRecord.etag) {
      setError("Missing server version. Please reload and try again.");
      return { ok: false, reason: "missing_etag" };
    }

    setActivity("saving");

    try {
      await storage.ensureAppRoot();
      await storage.ensureEventsFolder();

      if (hasPendingHistoryChunks) {
        const retryResult = await flushPendingHistoryChunks(pendingHistoryChunksRef.current);
        if (!retryResult.ok) {
          pendingHistoryChunksRef.current = retryResult.failedQueue;
          setRetryQueueCount(retryResult.failedQueue.length);
          const partialMessage = buildPartialFailureMessage(retryResult.failedQueue.length);
          const partialDetail = buildPartialFailureDetail(
            retryResult.failedQueue.length,
            retryResult.errorMessage,
          );
          setMessage(partialMessage);
          setError(partialDetail);
          return {
            ok: false,
            reason: "partial_failure",
            error: partialDetail,
          };
        }
        pendingHistoryChunksRef.current = [];
        setRetryQueueCount(0);
        if (pendingEvents.length === 0) {
          setMessage("History sync completed.");
          setError(null);
          return { ok: true };
        }
      }

      const now = new Date().toISOString();
      const repair = repairStateOnLoad(draftState, buildEventMeta());
      const hasRepair = repair.events.length > 0;
      const repairWarningMessage =
        hasRepair && repair.warnings.length > 0 ? repair.warnings.join(" ") : null;
      const repairedState = hasRepair ? repair.nextState : draftState;
      const eventsToSave = hasRepair ? [...pendingEvents, ...repair.events] : pendingEvents;
      if (hasRepair) {
        setDraftState(repair.nextState);
        setPendingEvents(eventsToSave);
        setAllocationNotice(repair.notice ?? null);
      }
      const versionedEvents = assignEventVersions(eventsToSave, snapshotRecord.snapshot.version);
      const nextVersion = snapshotRecord.snapshot.version + eventsToSave.length;
      const nextSnapshot: Snapshot = {
        version: nextVersion,
        stateJson: repairedState,
        updatedAt: now,
      };
      const currentEtag = snapshotRecord.etag;
      if (!currentEtag) {
        setError("Missing server version. Please reload and try again.");
        return { ok: false, reason: "missing_etag" };
      }

      const chunkIds = await storage.listEventChunkIds();
      const nextChunkId = chunkIds.length === 0 ? 1 : Math.max(...chunkIds) + 1;
      const chunks = buildEventChunks(versionedEvents, nextChunkId, MAX_EVENTS_PER_CHUNK, now);

      const writeResult = await storage.writePersonalSnapshot(nextSnapshot, {
        ifMatch: currentEtag,
      });

      const nextEtag = writeResult.etag ?? currentEtag;
      setSnapshotRecord({ snapshot: nextSnapshot, etag: nextEtag });
      setDraftState(nextSnapshot.stateJson);
      setPendingEvents([]);
      const lastEvent = versionedEvents[versionedEvents.length - 1];
      const latest = lastEvent
        ? {
            id: lastEvent.id,
            type: lastEvent.type,
            createdAt: lastEvent.createdAt,
            payload: lastEvent.payload,
          }
        : savedLatestEvent;
      setLatestEvent(latest ?? null);
      setSavedLatestEvent(latest ?? null);
      setSource("remote");
      setStatus("ready");
      setMessage(
        repairWarningMessage ? `${repairWarningMessage} Saved to cloud.` : "Saved to cloud.",
      );
      setError(null);

      await writeSnapshotCache({
        key: `personal:${activeProviderId}`,
        snapshot: nextSnapshot,
        etag: nextEtag,
        cachedAt: now,
      });
      const uploadQueue: QueuedChunkWrite[] = chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        content: serializeEventChunk(chunk),
      }));
      const uploadResult = await flushPendingHistoryChunks(uploadQueue);
      if (!uploadResult.ok) {
        pendingHistoryChunksRef.current = uploadResult.failedQueue;
        setRetryQueueCount(uploadResult.failedQueue.length);
        const partialMessage = buildPartialFailureMessage(uploadResult.failedQueue.length);
        const partialDetail = buildPartialFailureDetail(
          uploadResult.failedQueue.length,
          uploadResult.errorMessage,
        );
        setMessage(partialMessage);
        setError(partialDetail);
        return {
          ok: false,
          reason: "partial_failure",
          error: partialDetail,
        };
      }
      pendingHistoryChunksRef.current = [];
      setRetryQueueCount(0);
      return { ok: true };
    } catch (err) {
      if (isStoragePreconditionFailed(err)) {
        await handleConflict();
        return { ok: false, reason: "conflict" };
      }
      const message = formatGraphError(err);
      setError(message);
      return { ok: false, reason: "error", error: message };
    } finally {
      setActivity("idle");
    }
  }, [
    activeProviderId,
    draftState,
    flushPendingHistoryChunks,
    handleConflict,
    isOnline,
    isSignedIn,
    storage,
    pendingEvents,
    savedLatestEvent,
    snapshotRecord,
  ]);

  const buildLeasePayload = useCallback((): LeaseRecord => {
    const now = new Date();
    const holderLabel = account?.name ?? account?.email ?? "Anonymous";
    const deviceId = getDeviceId() ?? undefined;
    return {
      holderLabel,
      deviceId,
      leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
      updatedAt: now.toISOString(),
    };
  }, [account]);

  useEffect(() => {
    if (pendingEvents.length === 0 || !isOnline || !isSignedIn || !canWrite) {
      return;
    }
    const hasUserEdits = pendingEvents.some((event) => !LEASE_EDIT_EVENT_TYPES.has(event.type));
    if (!hasUserEdits) {
      return;
    }
    let isActive = true;
    const updateLease = async () => {
      try {
        await storage.ensureAppRoot();
        await storage.ensureLeasesFolder();
        const payload = buildLeasePayload();
        await storage.writePersonalLease(payload);
        if (isActive) {
          setLease(payload);
          setLeaseError(null);
        }
      } catch (err) {
        if (isActive) {
          setLeaseError(formatGraphError(err));
        }
      }
    };
    void updateLease();
    const intervalId = window.setInterval(() => {
      void updateLease();
    }, LEASE_REFRESH_MS);
    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [buildLeasePayload, canWrite, isOnline, isSignedIn, pendingEvents, storage]);

  const ensureEditableState = useCallback((): { state: NormalizedState } | { error: string } => {
    if (!isOnline) {
      return { error: "Offline mode is view-only. Please reconnect to edit." };
    }
    if (!isSignedIn) {
      return { error: "Sign in to edit." };
    }
    if (!canWrite) {
      return { error: readOnlyReason ?? "This space is read-only." };
    }
    if (!draftState) {
      return { error: "No snapshot is loaded yet." };
    }
    return { state: draftState };
  }, [canWrite, draftState, isOnline, isSignedIn, readOnlyReason]);

  const applyDomainResult = useCallback(
    (result: DomainActionResult, successMessage: string): DomainActionOutcome => {
      if ("error" in result) {
        setError(result.error);
        setMessage(null);
        return { ok: false, error: result.error };
      }
      setDraftState(result.nextState);
      setPendingEvents((prev) => [...prev, ...result.events]);
      if (result.notice) {
        setAllocationNotice(result.notice);
      }
      if (result.events.length > 0) {
        const lastEvent = result.events[result.events.length - 1];
        setLatestEvent(lastEvent);
      }
      setMessage(successMessage);
      setError(null);
      return { ok: true };
    },
    [],
  );

  const clearAllocationNotice = useCallback(() => {
    setAllocationNotice(null);
  }, []);

  const createAccount = useCallback(
    (name: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = createAccountDomain(
        editable.state,
        { id: createId(), name, scope: "personal" },
        meta,
      );
      return applyDomainResult(result, "Account created locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const updateAccount = useCallback(
    (accountId: string, name: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = updateAccountDomain(editable.state, { id: accountId, name }, meta);
      return applyDomainResult(result, "Account updated locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const deleteAccount = useCallback(
    (accountId: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = deleteAccountDomain(editable.state, accountId, meta);
      return applyDomainResult(result, "Account deleted locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const createPosition = useCallback(
    (input: {
      accountId: string;
      assetType: Position["assetType"];
      label: string;
      marketValue: number;
      allocationMode?: Position["allocationMode"];
    }): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = createPositionDomain(
        editable.state,
        {
          id: createId(),
          accountId: input.accountId,
          assetType: input.assetType,
          label: input.label,
          marketValue: input.marketValue,
          allocationMode: input.allocationMode,
        },
        meta,
      );
      return applyDomainResult(result, "Position created locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const updatePosition = useCallback(
    (input: {
      positionId: string;
      assetType: Position["assetType"];
      label: string;
      marketValue: number;
      allocationMode: Position["allocationMode"];
    }): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = updatePositionDomain(
        editable.state,
        {
          id: input.positionId,
          assetType: input.assetType,
          label: input.label,
          marketValue: input.marketValue,
          allocationMode: input.allocationMode,
        },
        meta,
      );
      return applyDomainResult(result, "Position updated locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const deletePosition = useCallback(
    (positionId: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = deletePositionDomain(editable.state, positionId, meta);
      return applyDomainResult(result, "Position deleted locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const createGoal = useCallback(
    (input: {
      name: string;
      targetAmount: number;
      priority: number;
      status: Goal["status"];
      startDate?: string;
      endDate?: string;
    }): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = createGoalDomain(
        editable.state,
        {
          id: createId(),
          scope: "personal",
          name: input.name,
          targetAmount: input.targetAmount,
          priority: input.priority,
          status: input.status,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        meta,
      );
      return applyDomainResult(result, "Goal created locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const updateGoal = useCallback(
    (input: {
      goalId: string;
      name: string;
      targetAmount: number;
      priority: number;
      status: Goal["status"];
      startDate?: string;
      endDate?: string;
    }): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = updateGoalDomain(
        editable.state,
        {
          id: input.goalId,
          name: input.name,
          targetAmount: input.targetAmount,
          priority: input.priority,
          status: input.status,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        meta,
      );
      return applyDomainResult(result, "Goal updated locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const deleteGoal = useCallback(
    (goalId: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = deleteGoalDomain(editable.state, goalId, meta);
      return applyDomainResult(result, "Goal deleted locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const createAllocation = useCallback(
    (input: {
      goalId: string;
      positionId: string;
      allocatedAmount: number;
    }): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = createAllocationDomain(
        editable.state,
        {
          id: createId(),
          goalId: input.goalId,
          positionId: input.positionId,
          allocatedAmount: input.allocatedAmount,
        },
        meta,
      );
      return applyDomainResult(result, "Allocation created locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const updateAllocation = useCallback(
    (allocationId: string, allocatedAmount: number): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = updateAllocationDomain(
        editable.state,
        { id: allocationId, allocatedAmount },
        meta,
      );
      return applyDomainResult(result, "Allocation updated locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const deleteAllocation = useCallback(
    (allocationId: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = deleteAllocationDomain(editable.state, allocationId, meta);
      return applyDomainResult(result, "Allocation deleted locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const reduceAllocations = useCallback(
    (reductions: { allocationId: string; amount: number }[]): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = reduceAllocationsDomain(editable.state, { reductions }, meta);
      return applyDomainResult(result, "Allocations reduced locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const spendGoal = useCallback(
    (input: { goalId: string; payments: { positionId: string; amount: number }[] }) => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = spendGoalDomain(editable.state, input, meta);
      return applyDomainResult(result, "Goal marked as spent locally.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const undoSpend = useCallback(
    (goalId: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      if (!latestEvent || latestEvent.type !== "goal_spent") {
        const message = "Undo is only available for the most recent spend event.";
        setError(message);
        setMessage(null);
        return { ok: false, error: message };
      }
      const payload = latestEvent.payload as { goalId?: string; spentAt?: string } | undefined;
      if (!payload || payload.goalId !== goalId) {
        const message = "Undo is only available for the most recent spend event.";
        setError(message);
        setMessage(null);
        return { ok: false, error: message };
      }
      const spentAt = payload.spentAt ? new Date(payload.spentAt) : null;
      if (!spentAt || Number.isNaN(spentAt.getTime())) {
        const message = "Undo data is invalid.";
        setError(message);
        setMessage(null);
        return { ok: false, error: message };
      }
      const elapsed = Date.now() - spentAt.getTime();
      if (elapsed > 24 * 60 * 60 * 1000) {
        const message = "Undo is only available for 24 hours after spending.";
        setError(message);
        setMessage(null);
        return { ok: false, error: message };
      }
      const meta = buildEventMeta();
      const result = undoSpendDomain(editable.state, { payload: latestEvent.payload }, meta);
      return applyDomainResult(result, "Spend undone locally.");
    },
    [applyDomainResult, ensureEditableState, latestEvent],
  );

  useEffect(() => {
    void loadFromCache();
  }, [loadFromCache]);

  useEffect(() => {
    if (isOnline && isSignedIn) {
      void loadFromRemoteRef.current?.();
    }
  }, [isOnline, isSignedIn]);

  useEffect(() => {
    if (prevPathnameRef.current === pathname) {
      return;
    }
    prevPathnameRef.current = pathname;
    if (!isOnline || !isSignedIn) {
      return;
    }
    if (!hasLocalDataRef.current) {
      return;
    }
    void loadFromRemoteRef.current?.({ background: true });
  }, [isOnline, isSignedIn, pathname]);

  useEffect(() => {
    upsertSyncSignal({
      key: buildPersonalSyncSignalKey(activeProviderId),
      activity,
      retryQueueCount,
      canWrite,
      canWriteKnown: true,
      lastSyncedAt: snapshotRecord?.snapshot.updatedAt ?? null,
    });
  }, [activity, activeProviderId, canWrite, retryQueueCount, snapshotRecord?.snapshot.updatedAt]);

  const value = useMemo(
    () => ({
      status,
      activity,
      source,
      snapshot: snapshotRecord?.snapshot ?? null,
      draftState,
      isOnline,
      isSignedIn,
      isDirty: pendingEvents.length > 0,
      retryQueueCount,
      canWrite,
      readOnlyReason,
      space,
      lease,
      leaseError,
      message,
      error,
      isRevalidating,
      allocationNotice,
      latestEvent,
      loadHistoryPage,
      refresh,
      createAccount,
      updateAccount,
      deleteAccount,
      createPosition,
      updatePosition,
      deletePosition,
      createGoal,
      updateGoal,
      deleteGoal,
      createAllocation,
      updateAllocation,
      deleteAllocation,
      reduceAllocations,
      spendGoal,
      undoSpend,
      clearAllocationNotice,
      saveChanges,
      discardChanges,
    }),
    [
      activity,
      allocationNotice,
      canWrite,
      clearAllocationNotice,
      createAccount,
      createAllocation,
      createGoal,
      createPosition,
      deleteAccount,
      deleteAllocation,
      deleteGoal,
      deletePosition,
      discardChanges,
      draftState,
      error,
      isOnline,
      isSignedIn,
      lease,
      leaseError,
      latestEvent,
      loadHistoryPage,
      message,
      isRevalidating,
      pendingEvents.length,
      retryQueueCount,
      reduceAllocations,
      readOnlyReason,
      refresh,
      saveChanges,
      snapshotRecord,
      source,
      spendGoal,
      space,
      status,
      undoSpend,
      updateAccount,
      updateAllocation,
      updateGoal,
      updatePosition,
    ],
  );

  return <PersonalDataContext.Provider value={value}>{children}</PersonalDataContext.Provider>;
}

export const usePersonalData = (): DataContextValue => {
  const context = useContext(PersonalDataContext);
  if (!context) {
    throw new Error("PersonalDataProvider is missing in the component tree.");
  }
  return context;
};
