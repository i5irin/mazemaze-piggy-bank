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
import { createId } from "@/lib/persistence/id";
import { createEmptySnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import { readSnapshotCache, writeSnapshotCache } from "@/lib/persistence/snapshotCache";
import { useOnlineStatus } from "@/lib/persistence/useOnlineStatus";
import type { Account, Allocation, Goal, NormalizedState, Position } from "@/lib/persistence/types";

const MAX_EVENTS_PER_CHUNK = 500;

type DataStatus = "idle" | "loading" | "ready" | "error";

type DataActivity = "idle" | "loading" | "saving";

type DataSource = "remote" | "cache" | "empty";

type SnapshotRecord = {
  snapshot: Snapshot;
  etag: string | null;
};

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
  applyDemoChange: () => void;
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

const createSeedState = (now: string) => {
  const account: Account = {
    id: createId(),
    scope: "personal",
    name: "Personal Cash",
  };
  const position: Position = {
    id: createId(),
    accountId: account.id,
    assetType: "cash",
    label: "Wallet",
    marketValue: 100000,
    updatedAt: now,
  };
  const goal: Goal = {
    id: createId(),
    scope: "personal",
    name: "Starter Goal",
    targetAmount: 200000,
    priority: 1,
    status: "active",
  };
  const allocation: Allocation = {
    id: createId(),
    goalId: goal.id,
    positionId: position.id,
    allocatedAmount: 50000,
  };
  return {
    nextState: {
      accounts: [account],
      positions: [position],
      goals: [goal],
      allocations: [allocation],
    },
    event: {
      id: createId(),
      type: "seed_state",
      createdAt: now,
      payload: {
        accountId: account.id,
        positionId: position.id,
        goalId: goal.id,
      },
    },
  };
};

const applyDemoChange = (state: NormalizedState, now: string) => {
  if (state.accounts.length === 0) {
    return createSeedState(now);
  }

  if (state.positions.length === 0) {
    const account = state.accounts[0];
    const position: Position = {
      id: createId(),
      accountId: account.id,
      assetType: "cash",
      label: "Cash Reserve",
      marketValue: 80000,
      updatedAt: now,
    };
    const nextState: NormalizedState = {
      ...state,
      positions: [position, ...state.positions],
    };
    return {
      nextState,
      event: {
        id: createId(),
        type: "position_added",
        createdAt: now,
        payload: {
          positionId: position.id,
          accountId: account.id,
        },
      },
    };
  }

  if (state.goals.length === 0) {
    const goal: Goal = {
      id: createId(),
      scope: "personal",
      name: "New Goal",
      targetAmount: 120000,
      priority: 1,
      status: "active",
    };
    const nextState: NormalizedState = {
      ...state,
      goals: [goal, ...state.goals],
    };
    return {
      nextState,
      event: {
        id: createId(),
        type: "goal_added",
        createdAt: now,
        payload: {
          goalId: goal.id,
        },
      },
    };
  }

  if (state.allocations.length === 0) {
    const allocation: Allocation = {
      id: createId(),
      goalId: state.goals[0].id,
      positionId: state.positions[0].id,
      allocatedAmount: 30000,
    };
    const nextState: NormalizedState = {
      ...state,
      allocations: [allocation, ...state.allocations],
    };
    return {
      nextState,
      event: {
        id: createId(),
        type: "allocation_added",
        createdAt: now,
        payload: {
          allocationId: allocation.id,
          goalId: allocation.goalId,
          positionId: allocation.positionId,
        },
      },
    };
  }

  const [firstPosition, ...restPositions] = state.positions;
  const updatedPosition: Position = {
    ...firstPosition,
    marketValue: firstPosition.marketValue + 1000,
    updatedAt: now,
  };

  let allocationAdjusted = false;
  const updatedAllocations = state.allocations.map((allocation) => {
    if (!allocationAdjusted && allocation.positionId === updatedPosition.id) {
      allocationAdjusted = true;
      return {
        ...allocation,
        allocatedAmount: Math.min(allocation.allocatedAmount + 500, updatedPosition.marketValue),
      };
    }
    return allocation;
  });

  const nextState: NormalizedState = {
    ...state,
    positions: [updatedPosition, ...restPositions],
    allocations: updatedAllocations,
  };

  return {
    nextState,
    event: {
      id: createId(),
      type: "position_market_value_adjusted",
      createdAt: now,
      payload: {
        positionId: updatedPosition.id,
        delta: 1000,
        allocationAdjusted,
      },
    },
  };
};

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
          applySnapshot(emptySnapshot, result.etag, "remote", "Initialized a new snapshot.");
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

  const handleDemoChange = useCallback(() => {
    if (!isOnline) {
      setMessage("Offline mode is view-only. Please reconnect to edit.");
      return;
    }
    if (!isSignedIn) {
      setMessage("Sign in to edit.");
      return;
    }
    if (!draftState) {
      setMessage("No snapshot is loaded yet.");
      return;
    }
    const now = new Date().toISOString();
    const { nextState, event } = applyDemoChange(draftState, now);
    setDraftState(nextState);
    setPendingEvents((prev) => [...prev, event]);
    setMessage("Draft updated. Save to sync.");
  }, [draftState, isOnline, isSignedIn]);

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
      applyDemoChange: handleDemoChange,
      saveChanges,
      discardChanges,
    }),
    [
      activity,
      discardChanges,
      draftState,
      error,
      handleDemoChange,
      isOnline,
      isSignedIn,
      message,
      pendingEvents.length,
      refresh,
      saveChanges,
      snapshotRecord,
      source,
      status,
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
