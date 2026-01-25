import type { NormalizedState } from "./types";

export type Snapshot = {
  version: number;
  stateJson: NormalizedState;
  updatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isScope = (value: unknown): value is "personal" | "shared" =>
  value === "personal" || value === "shared";

const isAssetType = (value: unknown): value is NormalizedState["positions"][number]["assetType"] =>
  value === "cash" ||
  value === "deposit" ||
  value === "fx" ||
  value === "securities" ||
  value === "crypto" ||
  value === "payout" ||
  value === "stored" ||
  value === "other";

const isAccount = (value: unknown): value is NormalizedState["accounts"][number] =>
  isRecord(value) && isString(value.id) && isScope(value.scope) && isString(value.name);

const isPosition = (value: unknown): value is NormalizedState["positions"][number] =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.accountId) &&
  isAssetType(value.assetType) &&
  isString(value.label) &&
  isNumber(value.marketValue) &&
  isString(value.updatedAt);

const isGoal = (value: unknown): value is NormalizedState["goals"][number] =>
  isRecord(value) &&
  isString(value.id) &&
  isScope(value.scope) &&
  isString(value.name) &&
  isNumber(value.targetAmount) &&
  isNumber(value.priority) &&
  (value.status === "active" || value.status === "closed") &&
  (value.startDate === undefined || isString(value.startDate)) &&
  (value.endDate === undefined || isString(value.endDate));

const isAllocation = (value: unknown): value is NormalizedState["allocations"][number] =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.goalId) &&
  isString(value.positionId) &&
  isNumber(value.allocatedAmount);

const isNormalizedState = (value: unknown): value is NormalizedState => {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.accounts) || !Array.isArray(value.positions)) {
    return false;
  }
  if (!Array.isArray(value.goals) || !Array.isArray(value.allocations)) {
    return false;
  }
  return (
    value.accounts.every(isAccount) &&
    value.positions.every(isPosition) &&
    value.goals.every(isGoal) &&
    value.allocations.every(isAllocation)
  );
};

export const createEmptyState = (): NormalizedState => ({
  accounts: [],
  positions: [],
  goals: [],
  allocations: [],
});

export const createEmptySnapshot = (now: string): Snapshot => ({
  version: 1,
  stateJson: createEmptyState(),
  updatedAt: now,
});

export const parseSnapshot = (text: string): Snapshot => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Snapshot file is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Snapshot file has an invalid shape.");
  }
  if (!isNumber(parsed.version) || !isString(parsed.updatedAt)) {
    throw new Error("Snapshot file has an invalid version or timestamp.");
  }
  if (!isNormalizedState(parsed.stateJson)) {
    throw new Error("Snapshot file has an invalid state payload.");
  }
  return {
    version: parsed.version,
    stateJson: parsed.stateJson,
    updatedAt: parsed.updatedAt,
  };
};
