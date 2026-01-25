"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGraphClient } from "@/lib/graph/graphClient";
import { isGraphError, isPreconditionFailed } from "@/lib/graph/graphErrors";
import { createOneDriveService } from "@/lib/onedrive/oneDriveService";
import {
  assignEventVersions,
  buildEventChunks,
  serializeEventChunk,
  type PendingEvent,
} from "@/lib/persistence/eventChunk";
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
  updateAccount as updateAccountDomain,
  updateAllocation as updateAllocationDomain,
  updateGoal as updateGoalDomain,
  updatePosition as updatePositionDomain,
  type DomainActionResult,
} from "@/lib/persistence/domain";
import { createId } from "@/lib/persistence/id";
import { createEmptySnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import { readSnapshotCache, writeSnapshotCache } from "@/lib/persistence/snapshotCache";
import { useOnlineStatus } from "@/lib/persistence/useOnlineStatus";
import type { Goal, NormalizedState, Position } from "@/lib/persistence/types";

const MAX_EVENTS_PER_CHUNK = 500;

type DataStatus = "idle" | "loading" | "ready" | "error";

type DataActivity = "idle" | "loading" | "saving";

type DataSource = "remote" | "cache" | "empty";

type SnapshotRecord = {
  snapshot: Snapshot;
  etag: string | null;
};

type DomainActionOutcome = { ok: true } | { ok: false; error: string };

type PersonalDataContextValue = {
  status: DataStatus;
  activity: DataActivity;
  source: DataSource;
  snapshot: Snapshot | null;
  draftState: NormalizedState | null;
  isOnline: boolean;
  isSignedIn: boolean;
  isDirty: boolean;
  message: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  createAccount: (name: string) => DomainActionOutcome;
  updateAccount: (accountId: string, name: string) => DomainActionOutcome;
  deleteAccount: (accountId: string) => DomainActionOutcome;
  createPosition: (input: {
    accountId: string;
    assetType: Position["assetType"];
    label: string;
    marketValue: number;
  }) => DomainActionOutcome;
  updatePosition: (input: {
    positionId: string;
    assetType: Position["assetType"];
    label: string;
    marketValue: number;
  }) => DomainActionOutcome;
  deletePosition: (positionId: string) => DomainActionOutcome;
  createGoal: (input: {
    name: string;
    targetAmount: number;
    priority: number;
    status: Goal["status"];
    startDate?: string;
    endDate?: string;
  }) => DomainActionOutcome;
  updateGoal: (input: {
    goalId: string;
    name: string;
    targetAmount: number;
    priority: number;
    status: Goal["status"];
    startDate?: string;
    endDate?: string;
  }) => DomainActionOutcome;
  deleteGoal: (goalId: string) => DomainActionOutcome;
  createAllocation: (input: {
    goalId: string;
    positionId: string;
    allocatedAmount: number;
  }) => DomainActionOutcome;
  updateAllocation: (allocationId: string, allocatedAmount: number) => DomainActionOutcome;
  deleteAllocation: (allocationId: string) => DomainActionOutcome;
  reduceAllocations: (
    reductions: { allocationId: string; amount: number }[],
  ) => DomainActionOutcome;
  saveChanges: () => Promise<void>;
  discardChanges: () => void;
};

const PersonalDataContext = createContext<PersonalDataContextValue | null>(null);

const formatGraphError = (error: unknown): string => {
  if (isGraphError(error)) {
    if (error.code === "unauthorized") {
      return "Authentication failed. Please sign in again.";
    }
    if (error.code === "forbidden") {
      return "Permission denied. Please consent to the required Graph scopes.";
    }
    if (error.code === "not_found") {
      return "The requested file was not found.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Please wait and try again.";
    }
    if (error.code === "network_error") {
      return "Network error. Please check your connection.";
    }
    if (error.code === "precondition_failed") {
      return "The data changed on OneDrive. Please reload and try again.";
    }
    return "Microsoft Graph request failed. Please try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
};

const buildEventMeta = () => ({
  eventId: createId(),
  createdAt: new Date().toISOString(),
});

export function PersonalDataProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, getAccessToken } = useAuth();
  const isOnline = useOnlineStatus();
  const isSignedIn = authStatus === "signed_in";

  const [status, setStatus] = useState<DataStatus>("idle");
  const [activity, setActivity] = useState<DataActivity>("idle");
  const [source, setSource] = useState<DataSource>("empty");
  const [snapshotRecord, setSnapshotRecord] = useState<SnapshotRecord | null>(null);
  const [draftState, setDraftState] = useState<NormalizedState | null>(null);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const graphScopes = useMemo(() => getGraphScopes(), []);
  const tokenProvider = useCallback((scopes: string[]) => getAccessToken(scopes), [getAccessToken]);

  const graphClient = useMemo(
    () =>
      createGraphClient({
        accessTokenProvider: tokenProvider,
      }),
    [tokenProvider],
  );

  const oneDrive = useMemo(
    () => createOneDriveService(graphClient, graphScopes),
    [graphClient, graphScopes],
  );

  const applySnapshot = useCallback(
    (snapshot: Snapshot, etag: string | null, sourceType: DataSource, notice: string | null) => {
      setSnapshotRecord({ snapshot, etag });
      setDraftState(snapshot.stateJson);
      setPendingEvents([]);
      setSource(sourceType);
      setStatus("ready");
      setMessage(notice);
      setError(null);
    },
    [],
  );

  const loadFromCache = useCallback(async () => {
    setStatus("loading");
    setActivity("loading");
    try {
      const cached = await readSnapshotCache();
      if (cached) {
        applySnapshot(cached.snapshot, cached.etag, "cache", "Loaded cached data.");
      } else {
        setStatus("error");
        setSource("empty");
        setMessage(null);
        setError("No cached data is available.");
      }
    } catch (err) {
      setStatus("error");
      setSource("empty");
      setMessage(null);
      setError(formatGraphError(err));
    } finally {
      setActivity("idle");
    }
  }, [applySnapshot]);

  const loadFromRemote = useCallback(async () => {
    setStatus("loading");
    setActivity("loading");
    try {
      await oneDrive.ensureAppRoot();
      const result = await oneDrive.readPersonalSnapshot();
      applySnapshot(result.snapshot, result.etag, "remote", "Synced from OneDrive.");
      await writeSnapshotCache({
        key: "personal",
        snapshot: result.snapshot,
        etag: result.etag,
        cachedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (isGraphError(err) && err.status === 404) {
        try {
          const now = new Date().toISOString();
          const emptySnapshot = createEmptySnapshot(now);
          const result = await oneDrive.writePersonalSnapshot(emptySnapshot);
          applySnapshot(
            emptySnapshot,
            result.etag,
            "remote",
            "No snapshot found yet. Add accounts or goals to create your first snapshot.",
          );
          await writeSnapshotCache({
            key: "personal",
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
      if (isGraphError(err) && err.code === "network_error") {
        await loadFromCache();
        setMessage("Offline mode. Showing cached data.");
        return;
      }
      setStatus("error");
      setSource("empty");
      setMessage(null);
      setError(formatGraphError(err));
    } finally {
      setActivity("idle");
    }
  }, [applySnapshot, loadFromCache, oneDrive]);

  const refresh = useCallback(async () => {
    if (!isOnline || !isSignedIn) {
      await loadFromCache();
      return;
    }
    await loadFromRemote();
  }, [isOnline, isSignedIn, loadFromCache, loadFromRemote]);

  const discardChanges = useCallback(() => {
    if (!snapshotRecord) {
      return;
    }
    setDraftState(snapshotRecord.snapshot.stateJson);
    setPendingEvents([]);
    setMessage("Discarded local edits.");
  }, [snapshotRecord]);

  const handleConflict = useCallback(async () => {
    await loadFromRemote();
    setMessage(
      "Save failed because the data changed elsewhere. Reloaded the latest data and discarded your edits.",
    );
  }, [loadFromRemote]);

  const saveChanges = useCallback(async () => {
    if (!isOnline) {
      setMessage("Offline mode is view-only. Please reconnect to save changes.");
      return;
    }
    if (!isSignedIn) {
      setMessage("Sign in to save changes.");
      return;
    }
    if (!snapshotRecord || !draftState) {
      setError("No snapshot is loaded yet.");
      return;
    }
    if (pendingEvents.length === 0) {
      setMessage("No changes to save.");
      return;
    }
    if (!snapshotRecord.etag) {
      setError("Missing server version. Please reload and try again.");
      return;
    }

    setActivity("saving");
    const now = new Date().toISOString();
    const versionedEvents = assignEventVersions(pendingEvents, snapshotRecord.snapshot.version);
    const nextVersion = snapshotRecord.snapshot.version + pendingEvents.length;
    const nextSnapshot: Snapshot = {
      version: nextVersion,
      stateJson: draftState,
      updatedAt: now,
    };

    try {
      await oneDrive.ensureAppRoot();
      await oneDrive.ensureEventsFolder();
      const chunkIds = await oneDrive.listEventChunkIds();
      const nextChunkId = chunkIds.length === 0 ? 1 : Math.max(...chunkIds) + 1;
      const chunks = buildEventChunks(versionedEvents, nextChunkId, MAX_EVENTS_PER_CHUNK, now);

      const writeResult = await oneDrive.writePersonalSnapshot(nextSnapshot, {
        ifMatch: snapshotRecord.etag,
      });

      const nextEtag = writeResult.etag ?? snapshotRecord.etag;
      setSnapshotRecord({ snapshot: nextSnapshot, etag: nextEtag });
      setDraftState(nextSnapshot.stateJson);
      setPendingEvents([]);
      setSource("remote");
      setStatus("ready");
      setMessage("Saved to OneDrive.");
      setError(null);

      await writeSnapshotCache({
        key: "personal",
        snapshot: nextSnapshot,
        etag: nextEtag,
        cachedAt: now,
      });
      try {
        for (const chunk of chunks) {
          await oneDrive.writeEventChunk(chunk.chunkId, serializeEventChunk(chunk));
        }
      } catch (eventError) {
        setMessage(
          "Snapshot saved, but event log update failed. Please retry when the connection is stable.",
        );
        setError(formatGraphError(eventError));
      }
    } catch (err) {
      if (isPreconditionFailed(err)) {
        await handleConflict();
        return;
      }
      setError(formatGraphError(err));
    } finally {
      setActivity("idle");
    }
  }, [draftState, handleConflict, isOnline, isSignedIn, oneDrive, pendingEvents, snapshotRecord]);

  const ensureEditableState = useCallback((): { state: NormalizedState } | { error: string } => {
    if (!isOnline) {
      return { error: "Offline mode is view-only. Please reconnect to edit." };
    }
    if (!isSignedIn) {
      return { error: "Sign in to edit." };
    }
    if (!draftState) {
      return { error: "No snapshot is loaded yet." };
    }
    return { state: draftState };
  }, [draftState, isOnline, isSignedIn]);

  const applyDomainResult = useCallback(
    (result: DomainActionResult, successMessage: string): DomainActionOutcome => {
      if ("error" in result) {
        setError(result.error);
        setMessage(null);
        return { ok: false, error: result.error };
      }
      setDraftState(result.nextState);
      setPendingEvents((prev) => [...prev, ...result.events]);
      setMessage(successMessage);
      setError(null);
      return { ok: true };
    },
    [],
  );

  const createAccount = useCallback(
    (name: string): DomainActionOutcome => {
      const editable = ensureEditableState();
      if ("error" in editable) {
        setError(editable.error);
        setMessage(null);
        return { ok: false, error: editable.error };
      }
      const meta = buildEventMeta();
      const result = createAccountDomain(editable.state, { id: createId(), name }, meta);
      return applyDomainResult(result, "Account created in draft.");
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
      return applyDomainResult(result, "Account updated in draft.");
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
      return applyDomainResult(result, "Account deleted in draft.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const createPosition = useCallback(
    (input: {
      accountId: string;
      assetType: Position["assetType"];
      label: string;
      marketValue: number;
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
        },
        meta,
      );
      return applyDomainResult(result, "Position created in draft.");
    },
    [applyDomainResult, ensureEditableState],
  );

  const updatePosition = useCallback(
    (input: {
      positionId: string;
      assetType: Position["assetType"];
      label: string;
      marketValue: number;
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
        },
        meta,
      );
      return applyDomainResult(result, "Position updated in draft.");
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
      return applyDomainResult(result, "Position deleted in draft.");
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
          name: input.name,
          targetAmount: input.targetAmount,
          priority: input.priority,
          status: input.status,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        meta,
      );
      return applyDomainResult(result, "Goal created in draft.");
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
      return applyDomainResult(result, "Goal updated in draft.");
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
      return applyDomainResult(result, "Goal deleted in draft.");
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
      return applyDomainResult(result, "Allocation created in draft.");
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
      return applyDomainResult(result, "Allocation updated in draft.");
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
      return applyDomainResult(result, "Allocation deleted in draft.");
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
      return applyDomainResult(result, "Allocations reduced in draft.");
    },
    [applyDomainResult, ensureEditableState],
  );

  useEffect(() => {
    void loadFromCache();
  }, [loadFromCache]);

  useEffect(() => {
    if (isOnline && isSignedIn) {
      void loadFromRemote();
    }
  }, [isOnline, isSignedIn, loadFromRemote]);

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
      message,
      error,
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
      saveChanges,
      discardChanges,
    }),
    [
      activity,
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
      message,
      pendingEvents.length,
      reduceAllocations,
      refresh,
      saveChanges,
      snapshotRecord,
      source,
      status,
      updateAccount,
      updateAllocation,
      updateGoal,
      updatePosition,
    ],
  );

  return <PersonalDataContext.Provider value={value}>{children}</PersonalDataContext.Provider>;
}

export const usePersonalData = (): PersonalDataContextValue => {
  const context = useContext(PersonalDataContext);
  if (!context) {
    throw new Error("PersonalDataProvider is missing in the component tree.");
  }
  return context;
};
