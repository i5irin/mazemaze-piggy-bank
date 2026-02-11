import type { LeaseRecord } from "@/lib/storage/lease";
import type { PendingEvent } from "@/lib/persistence/eventChunk";
import type { HistoryFilter, HistoryPage } from "@/lib/persistence/history";
import type { Snapshot } from "@/lib/persistence/snapshot";
import type { Goal, NormalizedState, Position } from "@/lib/persistence/types";
import type { AllocationNotice } from "@/lib/persistence/domain";

export type DataStatus = "idle" | "loading" | "ready" | "error";

export type DataActivity = "idle" | "loading" | "saving";

export type DataSource = "remote" | "cache" | "empty";

export type DomainActionOutcome = { ok: true } | { ok: false; error: string };
export type SaveChangesReason =
  | "offline"
  | "unauthenticated"
  | "read_only"
  | "invalid_space"
  | "partial_failure"
  | "no_snapshot"
  | "no_changes"
  | "missing_etag"
  | "conflict"
  | "error";
export type SaveChangesOutcome =
  | { ok: true }
  | { ok: false; reason: SaveChangesReason; error?: string };

export type SpaceInfo = {
  scope: "personal" | "shared";
  label: string;
  sharedId?: string;
  driveId?: string;
  itemId?: string;
  webUrl?: string;
};

export type DataContextValue = {
  status: DataStatus;
  activity: DataActivity;
  source: DataSource;
  snapshot: Snapshot | null;
  draftState: NormalizedState | null;
  isOnline: boolean;
  isSignedIn: boolean;
  isDirty: boolean;
  retryQueueCount: number;
  canWrite: boolean;
  readOnlyReason: string | null;
  space: SpaceInfo;
  lease: LeaseRecord | null;
  leaseError: string | null;
  message: string | null;
  error: string | null;
  isRevalidating?: boolean;
  allocationNotice: AllocationNotice | null;
  latestEvent: PendingEvent | null;
  loadHistoryPage: (input: {
    limit: number;
    cursor?: string | null;
    filter?: HistoryFilter;
  }) => Promise<HistoryPage>;
  refresh: () => Promise<void>;
  createAccount: (name: string) => DomainActionOutcome;
  updateAccount: (accountId: string, name: string) => DomainActionOutcome;
  deleteAccount: (accountId: string) => DomainActionOutcome;
  createPosition: (input: {
    accountId: string;
    assetType: Position["assetType"];
    label: string;
    marketValue: number;
    allocationMode?: Position["allocationMode"];
  }) => DomainActionOutcome;
  updatePosition: (input: {
    positionId: string;
    assetType: Position["assetType"];
    label: string;
    marketValue: number;
    allocationMode: Position["allocationMode"];
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
  spendGoal: (input: {
    goalId: string;
    payments: { positionId: string; amount: number }[];
  }) => DomainActionOutcome;
  undoSpend: (goalId: string) => DomainActionOutcome;
  clearAllocationNotice: () => void;
  saveChanges: () => Promise<SaveChangesOutcome>;
  discardChanges: () => void;
};
