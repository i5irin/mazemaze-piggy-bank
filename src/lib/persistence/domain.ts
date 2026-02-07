import type { PendingEvent } from "./eventChunk";
import type {
  Account,
  Allocation,
  AssetType,
  Goal,
  NormalizedState,
  Position,
  Scope,
} from "./types";

export type AllocationChange = {
  goalId: string;
  positionId: string;
  before: number;
  after: number;
};

export type AllocationNotice = {
  id: string;
  reason: "position_recalc" | "goal_target_reduce" | "integrity_repair" | "spend_repair";
  changes: AllocationChange[];
  affectedGoalIds: string[];
  affectedPositionIds: string[];
  totalReduced: number;
  requiresDirectEdit: boolean;
  directReasons: string[];
  createdAt: string;
};

export type DomainActionResult =
  | { nextState: NormalizedState; events: PendingEvent[]; notice?: AllocationNotice }
  | { error: string };

export type EventMeta = {
  eventId: string;
  createdAt: string;
};

const ASSET_TYPES: AssetType[] = [
  "cash",
  "deposit",
  "fx",
  "securities",
  "crypto",
  "payout",
  "stored",
  "other",
];

const ALLOCATION_MODES: Position["allocationMode"][] = ["fixed", "ratio", "priority"];

const DIRECT_GOAL_LIMIT = 3;
const DIRECT_PERCENT_LIMIT = 0.1;

const isNonEmptyString = (value: string): boolean => value.trim().length > 0;

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

const isAllocationMode = (value: string): value is Position["allocationMode"] =>
  ALLOCATION_MODES.includes(value as Position["allocationMode"]);

const normalizeOptionalDate = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isGoalActive = (goal: Goal): boolean => goal.status === "active" && !goal.spentAt;

const isGoalClosed = (goal: Goal): boolean => goal.status === "closed";

const isGoalSpent = (goal: Goal): boolean => Boolean(goal.spentAt);

const isGoalInactive = (goal: Goal): boolean => isGoalClosed(goal) || isGoalSpent(goal);

const buildEvent = (
  meta: EventMeta,
  type: string,
  payload: Record<string, unknown>,
): PendingEvent => ({
  id: meta.eventId,
  type,
  createdAt: meta.createdAt,
  payload,
});

const ensureUniqueId = (items: { id: string }[], id: string, label: string): string | null => {
  if (items.some((item) => item.id === id)) {
    return `${label} already exists.`;
  }
  return null;
};

const findAccount = (state: NormalizedState, accountId: string): Account | undefined =>
  state.accounts.find((account) => account.id === accountId);

const findPosition = (state: NormalizedState, positionId: string): Position | undefined =>
  state.positions.find((position) => position.id === positionId);

const findGoal = (state: NormalizedState, goalId: string): Goal | undefined =>
  state.goals.find((goal) => goal.id === goalId);

const getGoalPriority = (goal: Goal | undefined): number =>
  goal?.priority ?? Number.MAX_SAFE_INTEGER;

const compareAllocationsForReduction = (
  left: Allocation,
  right: Allocation,
  goalsById: Map<string, Goal>,
): number => {
  const leftGoal = goalsById.get(left.goalId);
  const rightGoal = goalsById.get(right.goalId);
  const leftInactive = leftGoal ? isGoalInactive(leftGoal) : false;
  const rightInactive = rightGoal ? isGoalInactive(rightGoal) : false;
  if (leftInactive !== rightInactive) {
    return leftInactive ? 1 : -1;
  }
  if (!leftInactive && !rightInactive) {
    const leftPriority = getGoalPriority(leftGoal);
    const rightPriority = getGoalPriority(rightGoal);
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }
  } else {
    const leftClosedAt = leftGoal?.closedAt;
    const rightClosedAt = rightGoal?.closedAt;
    if (leftClosedAt && rightClosedAt && leftClosedAt !== rightClosedAt) {
      return rightClosedAt.localeCompare(leftClosedAt);
    }
  }
  if (left.goalId !== right.goalId) {
    return left.goalId.localeCompare(right.goalId);
  }
  return left.positionId.localeCompare(right.positionId);
};

const getAllocationsForPosition = (state: NormalizedState, positionId: string): Allocation[] =>
  state.allocations.filter((allocation) => allocation.positionId === positionId);

const getPositionAllocationTotal = (
  state: NormalizedState,
  positionId: string,
  ignoreAllocationId?: string,
): number =>
  state.allocations.reduce((total, allocation) => {
    if (allocation.positionId !== positionId) {
      return total;
    }
    if (ignoreAllocationId && allocation.id === ignoreAllocationId) {
      return total;
    }
    return total + allocation.allocatedAmount;
  }, 0);

const getGoalAllocationTotal = (
  state: NormalizedState,
  goalId: string,
  options?: { ignoreAllocationId?: string; ignorePositionId?: string },
): number =>
  state.allocations.reduce((total, allocation) => {
    if (allocation.goalId !== goalId) {
      return total;
    }
    if (options?.ignoreAllocationId && allocation.id === options.ignoreAllocationId) {
      return total;
    }
    if (options?.ignorePositionId && allocation.positionId === options.ignorePositionId) {
      return total;
    }
    return total + allocation.allocatedAmount;
  }, 0);

const buildRemainingByGoal = (state: NormalizedState, positionId: string): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const allocation of state.allocations) {
    if (allocation.positionId === positionId) {
      continue;
    }
    totals.set(
      allocation.goalId,
      (totals.get(allocation.goalId) ?? 0) + allocation.allocatedAmount,
    );
  }
  const remainingByGoal = new Map<string, number>();
  for (const goal of state.goals) {
    const total = totals.get(goal.id) ?? 0;
    remainingByGoal.set(goal.id, Math.max(0, goal.targetAmount - total));
  }
  return remainingByGoal;
};

const reduceAllocationsToTotal = (
  allocations: Allocation[],
  targetTotal: number,
  goalsById: Map<string, Goal>,
): Allocation[] => {
  const currentTotal = allocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
  if (currentTotal <= targetTotal) {
    return allocations.map((allocation) => ({ ...allocation }));
  }
  let remainingReduction = currentTotal - targetTotal;
  const sorted = [...allocations].sort((left, right) =>
    compareAllocationsForReduction(left, right, goalsById),
  );
  const nextById = new Map(sorted.map((allocation) => [allocation.id, allocation.allocatedAmount]));
  for (const allocation of sorted) {
    if (remainingReduction <= 0) {
      break;
    }
    const current = nextById.get(allocation.id) ?? allocation.allocatedAmount;
    const reduction = Math.min(current, remainingReduction);
    nextById.set(allocation.id, current - reduction);
    remainingReduction -= reduction;
  }
  return allocations.map((allocation) => ({
    ...allocation,
    allocatedAmount: nextById.get(allocation.id) ?? allocation.allocatedAmount,
  }));
};

type RatioBucket = {
  kind: "allocation" | "unallocated";
  id: string;
  allocation?: Allocation;
  goalId?: string;
  positionId?: string;
  isActive: boolean;
  priority: number;
  weight: number;
  originalAmount: number;
  amount: number;
  cap: number | null;
};

const compareRatioBuckets = (left: RatioBucket, right: RatioBucket): number => {
  if (right.weight !== left.weight) {
    return right.weight - left.weight;
  }
  if (left.kind !== right.kind) {
    return left.kind === "allocation" ? -1 : 1;
  }
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  if (left.goalId && right.goalId && left.goalId !== right.goalId) {
    return left.goalId.localeCompare(right.goalId);
  }
  if (left.positionId && right.positionId && left.positionId !== right.positionId) {
    return left.positionId.localeCompare(right.positionId);
  }
  return 0;
};

const buildRatioBuckets = (
  allocations: Allocation[],
  oldValue: number,
  newValue: number,
  goalsById: Map<string, Goal>,
): RatioBucket[] => {
  const totalAllocated = allocations.reduce(
    (sum, allocation) => sum + allocation.allocatedAmount,
    0,
  );
  const unallocatedOld = Math.max(0, oldValue - totalAllocated);
  const buckets: RatioBucket[] = [
    ...allocations.map((allocation) => {
      const goal = goalsById.get(allocation.goalId);
      return {
        kind: "allocation" as const,
        id: allocation.goalId,
        allocation,
        goalId: allocation.goalId,
        positionId: allocation.positionId,
        isActive: goal ? isGoalActive(goal) : false,
        priority: getGoalPriority(goal),
        weight: allocation.allocatedAmount,
        originalAmount: allocation.allocatedAmount,
        amount: 0,
        cap: null,
      };
    }),
    {
      kind: "unallocated",
      id: "unallocated",
      isActive: false,
      priority: Number.MAX_SAFE_INTEGER,
      weight: unallocatedOld,
      originalAmount: unallocatedOld,
      amount: 0,
      cap: null,
    },
  ];

  for (const bucket of buckets) {
    bucket.amount = Math.floor((bucket.weight * newValue) / oldValue);
  }
  const baseTotal = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const remainder = newValue - baseTotal;
  if (remainder > 0) {
    const ordered = [...buckets].sort(compareRatioBuckets);
    for (let index = 0; index < remainder; index += 1) {
      const target = ordered[index % ordered.length];
      target.amount += 1;
    }
  }
  return buckets;
};

const applyGoalRemainingClamp = (
  buckets: RatioBucket[],
  remainingByGoal: Map<string, number>,
): RatioBucket[] => {
  let excess = 0;
  const unallocatedBucket = buckets.find((bucket) => bucket.kind === "unallocated");
  for (const bucket of buckets) {
    if (bucket.kind === "allocation") {
      const remaining = remainingByGoal.get(bucket.goalId ?? "") ?? 0;
      bucket.cap = bucket.isActive ? remaining : Math.min(remaining, bucket.originalAmount);
      if (bucket.amount > bucket.cap) {
        excess += bucket.amount - bucket.cap;
        bucket.amount = bucket.cap;
      }
    } else {
      bucket.cap = null;
    }
  }
  if (excess > 0 && unallocatedBucket) {
    unallocatedBucket.amount += excess;
  }
  return buckets;
};

const recalculatePriorityAllocations = (
  allocations: Allocation[],
  oldValue: number,
  newValue: number,
  goalsById: Map<string, Goal>,
  remainingByGoal: Map<string, number>,
): Allocation[] => {
  const delta = newValue - oldValue;
  const nextById = new Map(
    allocations.map((allocation) => [allocation.id, allocation.allocatedAmount]),
  );

  if (delta > 0) {
    let remainingDelta = delta;
    const sorted = allocations
      .filter((allocation) => {
        const goal = goalsById.get(allocation.goalId);
        return goal ? isGoalActive(goal) : false;
      })
      .sort((left, right) => {
        const leftPriority = getGoalPriority(goalsById.get(left.goalId));
        const rightPriority = getGoalPriority(goalsById.get(right.goalId));
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        if (left.goalId !== right.goalId) {
          return left.goalId.localeCompare(right.goalId);
        }
        return left.positionId.localeCompare(right.positionId);
      });
    for (const allocation of sorted) {
      if (remainingDelta <= 0) {
        break;
      }
      const current = nextById.get(allocation.id) ?? allocation.allocatedAmount;
      const remainingGoal = remainingByGoal.get(allocation.goalId) ?? 0;
      const maxIncrease = Math.max(0, remainingGoal - current);
      if (maxIncrease <= 0) {
        continue;
      }
      const increase = Math.min(remainingDelta, maxIncrease);
      nextById.set(allocation.id, current + increase);
      remainingDelta -= increase;
    }
  }

  const merged = allocations.map((allocation) => ({
    ...allocation,
    allocatedAmount: nextById.get(allocation.id) ?? allocation.allocatedAmount,
  }));
  return repairAllocationsForPosition(merged, newValue, goalsById, remainingByGoal);
};

export const recalculateAllocations = (
  allocations: Allocation[],
  oldValue: number,
  newValue: number,
): Allocation[] => {
  if (oldValue <= 0 || allocations.length === 0) {
    return allocations.map((allocation) => ({ ...allocation }));
  }
  const base = allocations.map((allocation) => ({
    ...allocation,
    allocatedAmount: Math.floor((allocation.allocatedAmount * newValue) / oldValue),
  }));
  const baseTotal = base.reduce((total, allocation) => total + allocation.allocatedAmount, 0);
  const remainder = newValue - baseTotal;
  if (remainder <= 0) {
    return base;
  }

  const priority = [...allocations].sort((left, right) => {
    if (right.allocatedAmount !== left.allocatedAmount) {
      return right.allocatedAmount - left.allocatedAmount;
    }
    if (left.goalId !== right.goalId) {
      return left.goalId.localeCompare(right.goalId);
    }
    return left.positionId.localeCompare(right.positionId);
  });

  const nextById = new Map(base.map((allocation) => [allocation.id, allocation.allocatedAmount]));
  for (let index = 0; index < remainder; index += 1) {
    const target = priority[index % priority.length];
    nextById.set(target.id, (nextById.get(target.id) ?? 0) + 1);
  }

  return allocations.map((allocation) => ({
    ...allocation,
    allocatedAmount: nextById.get(allocation.id) ?? allocation.allocatedAmount,
  }));
};

const allocationKey = (goalId: string, positionId: string): string => `${goalId}::${positionId}`;

const removeZeroAllocations = (allocations: Allocation[]): Allocation[] =>
  allocations.filter((allocation) => allocation.allocatedAmount > 0);

const buildAllocationChanges = (before: Allocation[], after: Allocation[]): AllocationChange[] => {
  const changes = new Map<string, AllocationChange>();
  for (const allocation of before) {
    changes.set(allocationKey(allocation.goalId, allocation.positionId), {
      goalId: allocation.goalId,
      positionId: allocation.positionId,
      before: allocation.allocatedAmount,
      after: 0,
    });
  }
  for (const allocation of after) {
    const key = allocationKey(allocation.goalId, allocation.positionId);
    const entry = changes.get(key);
    if (entry) {
      entry.after = allocation.allocatedAmount;
    } else {
      changes.set(key, {
        goalId: allocation.goalId,
        positionId: allocation.positionId,
        before: 0,
        after: allocation.allocatedAmount,
      });
    }
  }
  return Array.from(changes.values()).filter((change) => change.before !== change.after);
};

const buildAllocationNotice = (
  meta: EventMeta,
  reason: AllocationNotice["reason"],
  changes: AllocationChange[],
  goalsById: Map<string, Goal>,
  options?: { thresholdBase?: number; applyThresholds?: boolean },
): AllocationNotice | null => {
  if (changes.length === 0) {
    return null;
  }
  const reducedChanges = changes.filter((change) => change.after < change.before);
  if (reducedChanges.length === 0) {
    return null;
  }
  const affectedGoalIds = Array.from(new Set(reducedChanges.map((change) => change.goalId)));
  const affectedPositionIds = Array.from(
    new Set(reducedChanges.map((change) => change.positionId)),
  );
  const totalReduced = reducedChanges.reduce(
    (sum, change) => sum + (change.before - change.after),
    0,
  );
  const closedReduced = reducedChanges.some((change) => {
    const goal = goalsById.get(change.goalId);
    return goal ? isGoalInactive(goal) : false;
  });
  const applyThresholds = options?.applyThresholds ?? true;
  const overGoalLimit = affectedGoalIds.length > DIRECT_GOAL_LIMIT;
  const baseValue = options?.thresholdBase ?? 0;
  const overPercent = baseValue > 0 && totalReduced > baseValue * DIRECT_PERCENT_LIMIT;
  const requiresDirectEdit = applyThresholds && (closedReduced || overGoalLimit || overPercent);
  const directReasons: string[] = [];
  if (applyThresholds && closedReduced) {
    directReasons.push("Closed or spent goal allocations were reduced.");
  }
  if (applyThresholds && overGoalLimit) {
    directReasons.push("Too many goals were affected.");
  }
  if (applyThresholds && overPercent) {
    directReasons.push("The reduction exceeds the allowed percentage.");
  }
  return {
    id: meta.eventId,
    reason,
    changes,
    affectedGoalIds,
    affectedPositionIds,
    totalReduced,
    requiresDirectEdit,
    directReasons,
    createdAt: meta.createdAt,
  };
};

const reduceGoalAllocationsProportionally = (
  allocations: Allocation[],
  targetTotal: number,
): Allocation[] => {
  const total = allocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
  if (total <= targetTotal) {
    return allocations.map((allocation) => ({ ...allocation }));
  }
  const base = allocations.map((allocation) => ({
    ...allocation,
    allocatedAmount: Math.floor((allocation.allocatedAmount * targetTotal) / total),
  }));
  const baseTotal = base.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
  const remainder = targetTotal - baseTotal;
  if (remainder > 0) {
    const order = [...allocations].sort((left, right) => {
      if (right.allocatedAmount !== left.allocatedAmount) {
        return right.allocatedAmount - left.allocatedAmount;
      }
      return left.positionId.localeCompare(right.positionId);
    });
    const nextById = new Map(base.map((allocation) => [allocation.id, allocation.allocatedAmount]));
    for (let index = 0; index < remainder; index += 1) {
      const target = order[index % order.length];
      nextById.set(target.id, (nextById.get(target.id) ?? 0) + 1);
    }
    return allocations.map((allocation) => ({
      ...allocation,
      allocatedAmount: nextById.get(allocation.id) ?? allocation.allocatedAmount,
    }));
  }
  return base;
};

const clampAllocationsToRemaining = (
  allocations: Allocation[],
  remainingByGoal: Map<string, number>,
): Allocation[] =>
  allocations.map((allocation) => {
    const remaining = remainingByGoal.get(allocation.goalId) ?? 0;
    return {
      ...allocation,
      allocatedAmount: Math.min(allocation.allocatedAmount, remaining),
    };
  });

const repairAllocationsForPosition = (
  allocations: Allocation[],
  marketValue: number,
  goalsById: Map<string, Goal>,
  remainingByGoal: Map<string, number>,
): Allocation[] => {
  const clamped = clampAllocationsToRemaining(allocations, remainingByGoal);
  const total = clamped.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
  if (total <= marketValue) {
    return clamped;
  }
  return reduceAllocationsToTotal(clamped, marketValue, goalsById);
};

export const createAccount = (
  state: NormalizedState,
  input: { id: string; name: string; scope?: Scope },
  meta: EventMeta,
): DomainActionResult => {
  const trimmedName = input.name.trim();
  if (!isNonEmptyString(trimmedName)) {
    return { error: "Account name is required." };
  }
  const duplicateError = ensureUniqueId(state.accounts, input.id, "Account");
  if (duplicateError) {
    return { error: duplicateError };
  }
  const account: Account = {
    id: input.id,
    scope: input.scope ?? "personal",
    name: trimmedName,
  };
  return {
    nextState: { ...state, accounts: [...state.accounts, account] },
    events: [
      buildEvent(meta, "account_created", {
        accountId: account.id,
        name: account.name,
      }),
    ],
  };
};

export const updateAccount = (
  state: NormalizedState,
  input: { id: string; name: string },
  meta: EventMeta,
): DomainActionResult => {
  const account = findAccount(state, input.id);
  if (!account) {
    return { error: "Account not found." };
  }
  const trimmedName = input.name.trim();
  if (!isNonEmptyString(trimmedName)) {
    return { error: "Account name is required." };
  }
  const nextAccount: Account = { ...account, name: trimmedName };
  return {
    nextState: {
      ...state,
      accounts: state.accounts.map((item) => (item.id === account.id ? nextAccount : item)),
    },
    events: [
      buildEvent(meta, "account_updated", {
        accountId: account.id,
        name: nextAccount.name,
      }),
    ],
  };
};

export const deleteAccount = (
  state: NormalizedState,
  accountId: string,
  meta: EventMeta,
): DomainActionResult => {
  const account = findAccount(state, accountId);
  if (!account) {
    return { error: "Account not found." };
  }
  const positionIds = new Set(
    state.positions
      .filter((position) => position.accountId === accountId)
      .map((position) => position.id),
  );
  const nextPositions = state.positions.filter((position) => !positionIds.has(position.id));
  const nextAllocations = state.allocations.filter(
    (allocation) => !positionIds.has(allocation.positionId),
  );
  return {
    nextState: {
      ...state,
      accounts: state.accounts.filter((item) => item.id !== accountId),
      positions: nextPositions,
      allocations: nextAllocations,
    },
    events: [
      buildEvent(meta, "account_deleted", {
        accountId,
        name: account.name,
        removedPositions: positionIds.size,
        removedAllocations: state.allocations.length - nextAllocations.length,
      }),
    ],
  };
};

export const createPosition = (
  state: NormalizedState,
  input: {
    id: string;
    accountId: string;
    assetType: AssetType;
    label: string;
    marketValue: number;
    allocationMode?: Position["allocationMode"];
  },
  meta: EventMeta,
): DomainActionResult => {
  const account = findAccount(state, input.accountId);
  if (!account) {
    return { error: "Account not found." };
  }
  if (!ASSET_TYPES.includes(input.assetType)) {
    return { error: "Asset type is invalid." };
  }
  const trimmedLabel = input.label.trim();
  if (!isNonEmptyString(trimmedLabel)) {
    return { error: "Position label is required." };
  }
  if (!isNonNegativeInteger(input.marketValue)) {
    return { error: "Market value must be a non-negative integer." };
  }
  if (input.allocationMode && !isAllocationMode(input.allocationMode)) {
    return { error: "Allocation mode is invalid." };
  }
  const duplicateError = ensureUniqueId(state.positions, input.id, "Position");
  if (duplicateError) {
    return { error: duplicateError };
  }
  const position: Position = {
    id: input.id,
    accountId: input.accountId,
    assetType: input.assetType,
    label: trimmedLabel,
    marketValue: input.marketValue,
    allocationMode: input.allocationMode ?? "fixed",
    updatedAt: meta.createdAt,
  };
  return {
    nextState: { ...state, positions: [...state.positions, position] },
    events: [
      buildEvent(meta, "position_created", {
        positionId: position.id,
        accountId: position.accountId,
        accountName: account.name,
        assetType: position.assetType,
        label: position.label,
        marketValue: position.marketValue,
        allocationMode: position.allocationMode,
      }),
    ],
  };
};

export const updatePosition = (
  state: NormalizedState,
  input: {
    id: string;
    assetType: AssetType;
    label: string;
    marketValue: number;
    allocationMode: Position["allocationMode"];
  },
  meta: EventMeta,
): DomainActionResult => {
  const position = findPosition(state, input.id);
  if (!position) {
    return { error: "Position not found." };
  }
  const accountName = findAccount(state, position.accountId)?.name ?? null;
  if (!ASSET_TYPES.includes(input.assetType)) {
    return { error: "Asset type is invalid." };
  }
  const trimmedLabel = input.label.trim();
  if (!isNonEmptyString(trimmedLabel)) {
    return { error: "Position label is required." };
  }
  if (!isNonNegativeInteger(input.marketValue)) {
    return { error: "Market value must be a non-negative integer." };
  }
  if (!isAllocationMode(input.allocationMode)) {
    return { error: "Allocation mode is invalid." };
  }

  const marketValueChanged = position.marketValue !== input.marketValue;
  let nextAllocations = state.allocations;
  let recalculated = false;
  let notice: AllocationNotice | null = null;

  if (marketValueChanged) {
    const positionAllocations = getAllocationsForPosition(state, position.id);
    const goalsById = new Map(state.goals.map((goal) => [goal.id, goal]));
    let recalculatedAllocations = positionAllocations;
    if (input.allocationMode === "fixed") {
      const remainingByGoal = buildRemainingByGoal(state, position.id);
      recalculatedAllocations = repairAllocationsForPosition(
        positionAllocations,
        input.marketValue,
        goalsById,
        remainingByGoal,
      );
    } else if (input.allocationMode === "ratio") {
      const remainingByGoal = buildRemainingByGoal(state, position.id);
      if (position.marketValue <= 0) {
        const allocationTotal = getPositionAllocationTotal(state, position.id);
        const hasGoalOverage = positionAllocations.some((allocation) => {
          const remaining = remainingByGoal.get(allocation.goalId) ?? 0;
          return allocation.allocatedAmount > remaining;
        });
        if (allocationTotal > input.marketValue || hasGoalOverage) {
          recalculatedAllocations = repairAllocationsForPosition(
            positionAllocations,
            input.marketValue,
            goalsById,
            remainingByGoal,
          );
        }
      } else {
        const inactiveAllocations = positionAllocations.filter((allocation) => {
          const goal = goalsById.get(allocation.goalId);
          return goal ? isGoalInactive(goal) : true;
        });
        const activeAllocations = positionAllocations.filter((allocation) => {
          const goal = goalsById.get(allocation.goalId);
          return goal ? !isGoalInactive(goal) : false;
        });
        const inactiveTotalOriginal = inactiveAllocations.reduce(
          (sum, allocation) => sum + allocation.allocatedAmount,
          0,
        );
        const clampedInactive = inactiveAllocations.map((allocation) => {
          const remaining = remainingByGoal.get(allocation.goalId) ?? 0;
          return {
            ...allocation,
            allocatedAmount: Math.min(allocation.allocatedAmount, remaining),
          };
        });
        const inactiveTotal = clampedInactive.reduce(
          (sum, allocation) => sum + allocation.allocatedAmount,
          0,
        );

        if (inactiveTotal > input.marketValue) {
          recalculatedAllocations = repairAllocationsForPosition(
            positionAllocations,
            input.marketValue,
            goalsById,
            remainingByGoal,
          );
        } else {
          const activeOldTotal = activeAllocations.reduce(
            (sum, allocation) => sum + allocation.allocatedAmount,
            0,
          );
          const unallocatedOld = Math.max(
            0,
            position.marketValue - (activeOldTotal + inactiveTotalOriginal),
          );
          const ratioBase = activeOldTotal + unallocatedOld;
          const availableForActive = Math.max(0, input.marketValue - inactiveTotalOriginal);
          let nextActiveAllocations = activeAllocations.map((allocation) => ({ ...allocation }));
          if (ratioBase > 0) {
            const ratioBuckets = buildRatioBuckets(
              activeAllocations,
              ratioBase,
              availableForActive,
              goalsById,
            );
            const adjustedBuckets = applyGoalRemainingClamp(ratioBuckets, remainingByGoal);
            const allocationBuckets = adjustedBuckets.filter(
              (bucket): bucket is RatioBucket & { allocation: Allocation } =>
                bucket.kind === "allocation" && Boolean(bucket.allocation),
            );
            nextActiveAllocations = allocationBuckets.map((bucket) => ({
              ...bucket.allocation,
              allocatedAmount: bucket.amount,
            }));
          }
          recalculatedAllocations = repairAllocationsForPosition(
            [...clampedInactive, ...nextActiveAllocations],
            input.marketValue,
            goalsById,
            remainingByGoal,
          );
        }
      }
    } else {
      const remainingByGoal = buildRemainingByGoal(state, position.id);
      recalculatedAllocations = recalculatePriorityAllocations(
        positionAllocations,
        position.marketValue,
        input.marketValue,
        goalsById,
        remainingByGoal,
      );
    }

    const recalculatedById = new Map(
      recalculatedAllocations.map((allocation) => [allocation.id, allocation]),
    );
    const mergedAllocations = state.allocations.map(
      (allocation) => recalculatedById.get(allocation.id) ?? allocation,
    );
    nextAllocations = removeZeroAllocations(mergedAllocations);
    const nextPositionAllocations = nextAllocations.filter(
      (allocation) => allocation.positionId === position.id,
    );
    const changes = buildAllocationChanges(positionAllocations, nextPositionAllocations);
    recalculated = changes.length > 0;
    notice = buildAllocationNotice(meta, "position_recalc", changes, goalsById, {
      thresholdBase: input.marketValue,
      applyThresholds: true,
    });
  }

  const nextPosition: Position = {
    ...position,
    assetType: input.assetType,
    label: trimmedLabel,
    marketValue: input.marketValue,
    allocationMode: input.allocationMode,
    updatedAt: marketValueChanged ? meta.createdAt : position.updatedAt,
  };

  return {
    nextState: {
      ...state,
      positions: state.positions.map((item) => (item.id === position.id ? nextPosition : item)),
      allocations: nextAllocations,
    },
    notice: notice ?? undefined,
    events: [
      buildEvent(meta, "position_updated", {
        positionId: position.id,
        accountName,
        assetType: nextPosition.assetType,
        label: nextPosition.label,
        marketValue: nextPosition.marketValue,
        allocationMode: nextPosition.allocationMode,
        recalculated,
      }),
    ],
  };
};

export const deletePosition = (
  state: NormalizedState,
  positionId: string,
  meta: EventMeta,
): DomainActionResult => {
  const position = findPosition(state, positionId);
  if (!position) {
    return { error: "Position not found." };
  }
  const accountName = findAccount(state, position.accountId)?.name ?? null;
  const nextAllocations = state.allocations.filter(
    (allocation) => allocation.positionId !== positionId,
  );
  return {
    nextState: {
      ...state,
      positions: state.positions.filter((item) => item.id !== positionId),
      allocations: nextAllocations,
    },
    events: [
      buildEvent(meta, "position_deleted", {
        positionId,
        accountName,
        label: position.label,
        removedAllocations: state.allocations.length - nextAllocations.length,
      }),
    ],
  };
};

export const createGoal = (
  state: NormalizedState,
  input: {
    id: string;
    scope?: Scope;
    name: string;
    targetAmount: number;
    priority: number;
    status: "active" | "closed";
    startDate?: string;
    endDate?: string;
  },
  meta: EventMeta,
): DomainActionResult => {
  const trimmedName = input.name.trim();
  if (!isNonEmptyString(trimmedName)) {
    return { error: "Goal name is required." };
  }
  if (!isNonNegativeInteger(input.targetAmount)) {
    return { error: "Target amount must be a non-negative integer." };
  }
  if (!isNonNegativeInteger(input.priority)) {
    return { error: "Priority must be a non-negative integer." };
  }
  if (input.status !== "active" && input.status !== "closed") {
    return { error: "Goal status is invalid." };
  }
  const duplicateError = ensureUniqueId(state.goals, input.id, "Goal");
  if (duplicateError) {
    return { error: duplicateError };
  }
  const goal: Goal = {
    id: input.id,
    scope: input.scope ?? "personal",
    name: trimmedName,
    targetAmount: input.targetAmount,
    priority: input.priority,
    status: input.status,
    startDate: normalizeOptionalDate(input.startDate),
    endDate: normalizeOptionalDate(input.endDate),
    closedAt: input.status === "closed" ? meta.createdAt : undefined,
  };
  return {
    nextState: { ...state, goals: [...state.goals, goal] },
    events: [
      buildEvent(meta, "goal_created", {
        goalId: goal.id,
        name: goal.name,
        targetAmount: goal.targetAmount,
        status: goal.status,
      }),
    ],
  };
};

export const updateGoal = (
  state: NormalizedState,
  input: {
    id: string;
    name: string;
    targetAmount: number;
    priority: number;
    status: "active" | "closed";
    startDate?: string;
    endDate?: string;
  },
  meta: EventMeta,
): DomainActionResult => {
  const goal = findGoal(state, input.id);
  if (!goal) {
    return { error: "Goal not found." };
  }
  if (isGoalSpent(goal)) {
    return { error: "Spent goals cannot be edited." };
  }
  const trimmedName = input.name.trim();
  if (!isNonEmptyString(trimmedName)) {
    return { error: "Goal name is required." };
  }
  if (!isNonNegativeInteger(input.targetAmount)) {
    return { error: "Target amount must be a non-negative integer." };
  }
  if (!isNonNegativeInteger(input.priority)) {
    return { error: "Priority must be a non-negative integer." };
  }
  if (input.status !== "active" && input.status !== "closed") {
    return { error: "Goal status is invalid." };
  }
  const isReopening = goal.status === "closed" && input.status === "active";
  const isClosing = goal.status === "active" && input.status === "closed";
  const activePriorities = state.goals
    .filter((item) => item.id !== goal.id && isGoalActive(item))
    .map((item) => item.priority);
  const nextPriority = isReopening
    ? activePriorities.length > 0
      ? Math.max(...activePriorities) + 1
      : 1
    : input.priority;
  const nextClosedAt = isClosing ? meta.createdAt : isReopening ? undefined : goal.closedAt;

  const nextGoal: Goal = {
    ...goal,
    name: trimmedName,
    targetAmount: input.targetAmount,
    priority: nextPriority,
    status: input.status,
    startDate: normalizeOptionalDate(input.startDate),
    endDate: normalizeOptionalDate(input.endDate),
    closedAt: nextClosedAt,
  };
  const goalsById = new Map(state.goals.map((item) => [item.id, item]));
  const allocationsForGoal = state.allocations.filter(
    (allocation) => allocation.goalId === goal.id,
  );
  const allocationTotal = allocationsForGoal.reduce(
    (sum, allocation) => sum + allocation.allocatedAmount,
    0,
  );
  let nextAllocations = state.allocations;
  let notice: AllocationNotice | null = null;
  if (allocationTotal > nextGoal.targetAmount) {
    const reduced = reduceGoalAllocationsProportionally(allocationsForGoal, nextGoal.targetAmount);
    const reducedById = new Map(reduced.map((allocation) => [allocation.id, allocation]));
    const merged = state.allocations.map(
      (allocation) => reducedById.get(allocation.id) ?? allocation,
    );
    nextAllocations = removeZeroAllocations(merged);
    const changes = buildAllocationChanges(
      allocationsForGoal,
      nextAllocations.filter((allocation) => allocation.goalId === goal.id),
    );
    notice = buildAllocationNotice(meta, "goal_target_reduce", changes, goalsById, {
      applyThresholds: false,
    });
  }
  return {
    nextState: {
      ...state,
      goals: state.goals.map((item) => (item.id === goal.id ? nextGoal : item)),
      allocations: nextAllocations,
    },
    notice: notice ?? undefined,
    events: [
      buildEvent(meta, "goal_updated", {
        goalId: goal.id,
        name: nextGoal.name,
        targetAmount: nextGoal.targetAmount,
        status: nextGoal.status,
      }),
    ],
  };
};

export const deleteGoal = (
  state: NormalizedState,
  goalId: string,
  meta: EventMeta,
): DomainActionResult => {
  const goal = findGoal(state, goalId);
  if (!goal) {
    return { error: "Goal not found." };
  }
  if (isGoalSpent(goal)) {
    return { error: "Spent goals cannot be edited." };
  }
  const nextAllocations = state.allocations.filter((allocation) => allocation.goalId !== goalId);
  return {
    nextState: {
      ...state,
      goals: state.goals.filter((item) => item.id !== goalId),
      allocations: nextAllocations,
    },
    events: [
      buildEvent(meta, "goal_deleted", {
        goalId,
        name: goal.name,
        removedAllocations: state.allocations.length - nextAllocations.length,
      }),
    ],
  };
};

export const createAllocation = (
  state: NormalizedState,
  input: { id: string; goalId: string; positionId: string; allocatedAmount: number },
  meta: EventMeta,
): DomainActionResult => {
  const position = findPosition(state, input.positionId);
  if (!position) {
    return { error: "Position not found." };
  }
  const goal = findGoal(state, input.goalId);
  if (!goal) {
    return { error: "Goal not found." };
  }
  const account = findAccount(state, position.accountId);
  if (!account) {
    return { error: "Account not found." };
  }
  if (account.scope !== goal.scope) {
    return { error: "Allocation scope must match the goal scope." };
  }
  if (!isNonNegativeInteger(input.allocatedAmount)) {
    return { error: "Allocated amount must be a non-negative integer." };
  }
  if (isGoalSpent(goal)) {
    return { error: "Spent goals cannot be edited." };
  }
  const existing = state.allocations.find(
    (allocation) =>
      allocation.goalId === input.goalId && allocation.positionId === input.positionId,
  );
  if (input.allocatedAmount === 0) {
    if (!existing) {
      return { error: "Allocated amount must be greater than zero." };
    }
    const nextAllocations = state.allocations.filter((item) => item.id !== existing.id);
    return {
      nextState: { ...state, allocations: nextAllocations },
      events: [
        buildEvent(meta, "allocation_deleted", {
          allocationId: existing.id,
          goalId: existing.goalId,
          positionId: existing.positionId,
          goalName: goal.name,
          positionLabel: position.label,
          accountName: account.name,
        }),
      ],
    };
  }
  if (existing) {
    const currentTotal = getPositionAllocationTotal(state, input.positionId, existing.id);
    if (currentTotal + input.allocatedAmount > position.marketValue) {
      return { error: "Allocation total exceeds the position market value." };
    }
    const goalTotal = getGoalAllocationTotal(state, input.goalId, {
      ignoreAllocationId: existing.id,
    });
    if (goalTotal + input.allocatedAmount > goal.targetAmount) {
      return { error: "Allocation total exceeds the goal target amount." };
    }
    const nextAllocation: Allocation = { ...existing, allocatedAmount: input.allocatedAmount };
    const nextAllocations = state.allocations.map((item) =>
      item.id === existing.id ? nextAllocation : item,
    );
    return {
      nextState: { ...state, allocations: nextAllocations },
      events: [
        buildEvent(meta, "allocation_updated", {
          allocationId: existing.id,
          goalId: existing.goalId,
          positionId: existing.positionId,
          amount: nextAllocation.allocatedAmount,
          goalName: goal.name,
          positionLabel: position.label,
          accountName: account.name,
        }),
      ],
    };
  }
  const duplicateError = ensureUniqueId(state.allocations, input.id, "Allocation");
  if (duplicateError) {
    return { error: duplicateError };
  }
  const currentTotal = getPositionAllocationTotal(state, input.positionId);
  if (currentTotal + input.allocatedAmount > position.marketValue) {
    return { error: "Allocation total exceeds the position market value." };
  }
  const goalTotal = getGoalAllocationTotal(state, input.goalId);
  if (goalTotal + input.allocatedAmount > goal.targetAmount) {
    return { error: "Allocation total exceeds the goal target amount." };
  }
  const allocation: Allocation = {
    id: input.id,
    goalId: input.goalId,
    positionId: input.positionId,
    allocatedAmount: input.allocatedAmount,
  };
  return {
    nextState: { ...state, allocations: [...state.allocations, allocation] },
    events: [
      buildEvent(meta, "allocation_created", {
        allocationId: allocation.id,
        goalId: allocation.goalId,
        positionId: allocation.positionId,
        amount: allocation.allocatedAmount,
        goalName: goal.name,
        positionLabel: position.label,
        accountName: account.name,
      }),
    ],
  };
};

export const updateAllocation = (
  state: NormalizedState,
  input: { id: string; allocatedAmount: number },
  meta: EventMeta,
): DomainActionResult => {
  const allocation = state.allocations.find((item) => item.id === input.id);
  if (!allocation) {
    return { error: "Allocation not found." };
  }
  if (!isNonNegativeInteger(input.allocatedAmount)) {
    return { error: "Allocated amount must be a non-negative integer." };
  }
  const goal = findGoal(state, allocation.goalId);
  if (!goal) {
    return { error: "Goal not found." };
  }
  if (isGoalSpent(goal)) {
    return { error: "Spent goals cannot be edited." };
  }
  if (input.allocatedAmount === 0) {
    return deleteAllocation(state, allocation.id, meta);
  }
  const position = findPosition(state, allocation.positionId);
  if (!position) {
    return { error: "Position not found." };
  }
  const account = findAccount(state, position.accountId);
  if (!account) {
    return { error: "Account not found." };
  }
  if (account.scope !== goal.scope) {
    return { error: "Allocation scope must match the goal scope." };
  }
  const currentTotal = getPositionAllocationTotal(state, allocation.positionId, allocation.id);
  if (currentTotal + input.allocatedAmount > position.marketValue) {
    return { error: "Allocation total exceeds the position market value." };
  }
  const goalTotal = getGoalAllocationTotal(state, allocation.goalId, {
    ignoreAllocationId: allocation.id,
  });
  if (goalTotal + input.allocatedAmount > goal.targetAmount) {
    return { error: "Allocation total exceeds the goal target amount." };
  }
  const nextAllocation: Allocation = { ...allocation, allocatedAmount: input.allocatedAmount };
  return {
    nextState: {
      ...state,
      allocations: state.allocations.map((item) =>
        item.id === allocation.id ? nextAllocation : item,
      ),
    },
    events: [
      buildEvent(meta, "allocation_updated", {
        allocationId: allocation.id,
        goalId: allocation.goalId,
        positionId: allocation.positionId,
        amount: nextAllocation.allocatedAmount,
      }),
    ],
  };
};

export const deleteAllocation = (
  state: NormalizedState,
  allocationId: string,
  meta: EventMeta,
): DomainActionResult => {
  const allocation = state.allocations.find((item) => item.id === allocationId);
  if (!allocation) {
    return { error: "Allocation not found." };
  }
  const goal = findGoal(state, allocation.goalId);
  if (goal && isGoalSpent(goal)) {
    return { error: "Spent goals cannot be edited." };
  }
  const position = findPosition(state, allocation.positionId);
  const accountName = position ? (findAccount(state, position.accountId)?.name ?? null) : null;
  return {
    nextState: {
      ...state,
      allocations: state.allocations.filter((item) => item.id !== allocationId),
    },
    events: [
      buildEvent(meta, "allocation_deleted", {
        allocationId,
        goalId: allocation.goalId,
        positionId: allocation.positionId,
        goalName: goal?.name ?? null,
        positionLabel: position?.label ?? null,
        accountName,
      }),
    ],
  };
};

export const reduceAllocations = (
  state: NormalizedState,
  input: { reductions: { allocationId: string; amount: number }[] },
  meta: EventMeta,
): DomainActionResult => {
  if (input.reductions.length === 0) {
    return { error: "Select at least one allocation to reduce." };
  }

  const allocationMap = new Map(state.allocations.map((allocation) => [allocation.id, allocation]));
  const normalized = input.reductions
    .map((item) => ({
      allocation: allocationMap.get(item.allocationId),
      amount: item.amount,
    }))
    .filter((item): item is { allocation: Allocation; amount: number } => Boolean(item.allocation));

  if (normalized.length === 0) {
    return { error: "Allocation not found." };
  }

  for (const item of normalized) {
    const goal = findGoal(state, item.allocation.goalId);
    if (goal && isGoalSpent(goal)) {
      return { error: "Spent goals cannot be edited." };
    }
  }

  for (const item of normalized) {
    if (!isNonNegativeInteger(item.amount)) {
      return { error: "Reduction amounts must be non-negative integers." };
    }
    if (item.amount > item.allocation.allocatedAmount) {
      return { error: "Reduction amount cannot exceed the current allocation." };
    }
  }

  const hasReduction = normalized.some((item) => item.amount > 0);
  if (!hasReduction) {
    return { error: "Enter a reduction amount greater than zero." };
  }

  const nextAllocations = removeZeroAllocations(
    state.allocations.map((allocation) => {
      const reduction = normalized.find((item) => item.allocation.id === allocation.id);
      if (!reduction) {
        return allocation;
      }
      return {
        ...allocation,
        allocatedAmount: allocation.allocatedAmount - reduction.amount,
      };
    }),
  );
  const affectedGoalIds = Array.from(new Set(normalized.map((item) => item.allocation.goalId)));
  const affectedPositionIds = Array.from(
    new Set(normalized.map((item) => item.allocation.positionId)),
  );

  return {
    nextState: { ...state, allocations: nextAllocations },
    events: [
      buildEvent(meta, "allocations_reduced", {
        affectedGoalIds,
        affectedPositionIds,
        reductions: normalized.map((item) => ({
          allocationId: item.allocation.id,
          goalId: item.allocation.goalId,
          positionId: item.allocation.positionId,
          amount: item.amount,
        })),
      }),
    ],
  };
};

export type IntegrityRepairResult = {
  nextState: NormalizedState;
  notice?: AllocationNotice;
  warnings: string[];
  events: PendingEvent[];
};

export const repairStateOnLoad = (
  state: NormalizedState,
  meta: EventMeta,
): IntegrityRepairResult => {
  const warnings: string[] = [];
  let correctedNegative = 0;
  const positions = state.positions.map((position) => {
    if (position.marketValue < 0) {
      correctedNegative += 1;
      return { ...position, marketValue: 0 };
    }
    return position;
  });
  const goals = state.goals.map((goal) => {
    if (goal.targetAmount < 0) {
      correctedNegative += 1;
      return { ...goal, targetAmount: 0 };
    }
    return goal;
  });
  const allocationsSeed = state.allocations.map((allocation) => {
    if (allocation.allocatedAmount < 0) {
      correctedNegative += 1;
      return { ...allocation, allocatedAmount: 0 };
    }
    return allocation;
  });
  if (correctedNegative > 0) {
    warnings.push("Negative values were corrected to zero.");
  }

  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const positionsById = new Map(positions.map((position) => [position.id, position]));
  const accountsById = new Map(state.accounts.map((account) => [account.id, account]));

  let removedMissing = 0;
  let removedSpent = 0;
  let removedScopeMismatch = 0;
  const allocations = allocationsSeed.filter((allocation) => {
    const goal = goalsById.get(allocation.goalId);
    const position = positionsById.get(allocation.positionId);
    if (!goal || !position) {
      removedMissing += 1;
      return false;
    }
    if (goal.spentAt) {
      removedSpent += 1;
      return false;
    }
    const account = accountsById.get(position.accountId);
    if (!account || account.scope !== goal.scope) {
      removedScopeMismatch += 1;
      return false;
    }
    return true;
  });
  const danglingCount = removedMissing + removedScopeMismatch;
  if (removedMissing > 0) {
    warnings.push("Some allocations were removed because their goal or position no longer exists.");
  }
  if (removedScopeMismatch > 0) {
    warnings.push("Allocations with mismatched scopes were removed.");
  }
  if (removedSpent > 0) {
    warnings.push("Allocations linked to spent goals were removed.");
  }

  const grouped = new Map<string, Allocation[]>();
  for (const allocation of allocations) {
    const key = allocationKey(allocation.goalId, allocation.positionId);
    const current = grouped.get(key);
    if (current) {
      current.push(allocation);
    } else {
      grouped.set(key, [allocation]);
    }
  }
  const deduped: Allocation[] = [];
  let duplicateRemoved = 0;
  for (const entries of grouped.values()) {
    if (entries.length === 1) {
      deduped.push(entries[0]);
      continue;
    }
    let chosen = entries[0];
    for (const entry of entries.slice(1)) {
      if (entry.allocatedAmount > chosen.allocatedAmount) {
        chosen = entry;
      }
    }
    deduped.push(chosen);
    duplicateRemoved += entries.length - 1;
  }
  if (duplicateRemoved > 0) {
    warnings.push("Duplicate allocations were consolidated.");
  }

  const cleanedAllocations = deduped;
  const nextById = new Map(cleanedAllocations.map((allocation) => [allocation.id, allocation]));

  for (const position of positions) {
    const positionAllocations = Array.from(nextById.values()).filter(
      (allocation) => allocation.positionId === position.id,
    );
    const total = positionAllocations.reduce(
      (sum, allocation) => sum + allocation.allocatedAmount,
      0,
    );
    if (total <= position.marketValue) {
      continue;
    }
    const reduced = reduceAllocationsToTotal(positionAllocations, position.marketValue, goalsById);
    for (const allocation of reduced) {
      nextById.set(allocation.id, allocation);
    }
  }

  for (const goal of goals) {
    const goalAllocations = Array.from(nextById.values()).filter(
      (allocation) => allocation.goalId === goal.id,
    );
    const total = goalAllocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
    if (total <= goal.targetAmount) {
      continue;
    }
    const reduced = reduceGoalAllocationsProportionally(goalAllocations, goal.targetAmount);
    for (const allocation of reduced) {
      nextById.set(allocation.id, allocation);
    }
  }

  const repairedAllocations = removeZeroAllocations(Array.from(nextById.values()));
  const changes = buildAllocationChanges(cleanedAllocations, repairedAllocations);
  const reducedChanges = changes.filter((change) => change.after < change.before);
  const affectedGoalIds = Array.from(new Set(reducedChanges.map((change) => change.goalId)));
  const affectedPositionIds = Array.from(
    new Set(reducedChanges.map((change) => change.positionId)),
  );
  const thresholdBase = affectedPositionIds.reduce((sum, positionId) => {
    const position = positionsById.get(positionId);
    return sum + (position?.marketValue ?? 0);
  }, 0);
  const notice = buildAllocationNotice(meta, "integrity_repair", changes, goalsById, {
    thresholdBase,
    applyThresholds: true,
  });

  const hasChanges =
    danglingCount > 0 || duplicateRemoved > 0 || changes.length > 0 || correctedNegative > 0;
  const events: PendingEvent[] = [];
  if (hasChanges) {
    events.push(
      buildEvent(meta, "state_repaired", {
        removedDangling: danglingCount,
        removedDuplicates: duplicateRemoved,
        allocationChanges: reducedChanges.length,
        correctedNegative,
        affectedGoalIds,
        affectedPositionIds,
      }),
    );
  }

  return {
    nextState: {
      ...state,
      positions,
      goals,
      allocations: repairedAllocations,
    },
    notice: notice ?? undefined,
    warnings,
    events,
  };
};

type SpendPayment = {
  positionId: string;
  amount: number;
};

type SpendEventPayload = {
  goalId: string;
  goalName?: string;
  spentAt: string;
  totalAmount: number;
  payments: SpendPayment[];
  allocations: Allocation[];
  positions: { id: string; marketValueBefore: number; marketValueAfter: number }[];
};

const isSpendEventPayload = (value: unknown): value is SpendEventPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as SpendEventPayload;
  if (!payload.goalId || !payload.spentAt || !Array.isArray(payload.payments)) {
    return false;
  }
  if (!Array.isArray(payload.allocations) || !Array.isArray(payload.positions)) {
    return false;
  }
  return true;
};

export const spendGoal = (
  state: NormalizedState,
  input: { goalId: string; payments: SpendPayment[] },
  meta: EventMeta,
): DomainActionResult => {
  const goal = findGoal(state, input.goalId);
  if (!goal) {
    return { error: "Goal not found." };
  }
  if (goal.status !== "closed") {
    return { error: "Only closed goals can be spent." };
  }
  if (goal.spentAt) {
    return { error: "This goal is already marked as spent." };
  }
  const allocationsForGoal = state.allocations.filter(
    (allocation) => allocation.goalId === goal.id,
  );
  if (allocationsForGoal.length === 0) {
    return { error: "No allocations are available to spend." };
  }
  const totalAmount = allocationsForGoal.reduce(
    (sum, allocation) => sum + allocation.allocatedAmount,
    0,
  );
  const payments = input.payments.map((payment) => ({
    positionId: payment.positionId,
    amount: payment.amount,
  }));
  const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paymentTotal !== totalAmount) {
    return { error: "Payments must total the goal allocation amount." };
  }
  for (const payment of payments) {
    if (!isNonNegativeInteger(payment.amount)) {
      return { error: "Payment amounts must be non-negative integers." };
    }
  }
  const allocationsByPosition = new Map(
    allocationsForGoal.map((allocation) => [allocation.positionId, allocation]),
  );
  for (const payment of payments) {
    const allocation = allocationsByPosition.get(payment.positionId);
    if (!allocation) {
      return { error: "Payments must use positions allocated to this goal." };
    }
    if (payment.amount > allocation.allocatedAmount) {
      return { error: "Payment amounts cannot exceed allocated amounts." };
    }
  }
  const positionsById = new Map(state.positions.map((position) => [position.id, position]));
  const positionUpdates = new Map<string, { before: number; after: number }>();
  for (const payment of payments) {
    const position = positionsById.get(payment.positionId);
    if (!position) {
      return { error: "Position not found." };
    }
    const current = positionUpdates.get(position.id)?.after ?? position.marketValue;
    if (current - payment.amount < 0) {
      return { error: "Payment exceeds the position market value." };
    }
    positionUpdates.set(position.id, {
      before: position.marketValue,
      after: current - payment.amount,
    });
  }

  let nextAllocations = state.allocations.filter((allocation) => allocation.goalId !== goal.id);
  const nextPositions = state.positions.map((position) => {
    const update = positionUpdates.get(position.id);
    if (!update) {
      return position;
    }
    return {
      ...position,
      marketValue: update.after,
      updatedAt: meta.createdAt,
    };
  });

  const goalsById = new Map(state.goals.map((item) => [item.id, item]));
  const affectedPositionIds = Array.from(positionUpdates.keys());
  const repairedById = new Map(nextAllocations.map((allocation) => [allocation.id, allocation]));
  for (const positionId of affectedPositionIds) {
    const position = nextPositions.find((item) => item.id === positionId);
    if (!position) {
      continue;
    }
    const positionAllocations = Array.from(repairedById.values()).filter(
      (allocation) => allocation.positionId === positionId,
    );
    const remainingByGoal = buildRemainingByGoal(
      { ...state, allocations: nextAllocations },
      positionId,
    );
    const repaired = repairAllocationsForPosition(
      positionAllocations,
      position.marketValue,
      goalsById,
      remainingByGoal,
    );
    for (const allocation of repaired) {
      repairedById.set(allocation.id, allocation);
    }
  }
  const repairedAllocations = removeZeroAllocations(Array.from(repairedById.values()));
  const repairChanges = buildAllocationChanges(nextAllocations, repairedAllocations);
  const thresholdBase = affectedPositionIds.reduce((sum, positionId) => {
    const position = nextPositions.find((item) => item.id === positionId);
    return sum + (position?.marketValue ?? 0);
  }, 0);
  const repairNotice = buildAllocationNotice(meta, "spend_repair", repairChanges, goalsById, {
    thresholdBase,
    applyThresholds: true,
  });
  nextAllocations = repairedAllocations;

  const nextGoal: Goal = { ...goal, spentAt: meta.createdAt };

  const payload: SpendEventPayload = {
    goalId: goal.id,
    goalName: goal.name,
    spentAt: meta.createdAt,
    totalAmount,
    payments,
    allocations: allocationsForGoal,
    positions: Array.from(positionUpdates.entries()).map(([id, update]) => ({
      id,
      marketValueBefore: update.before,
      marketValueAfter: update.after,
    })),
  };

  return {
    nextState: {
      ...state,
      goals: state.goals.map((item) => (item.id === goal.id ? nextGoal : item)),
      positions: nextPositions,
      allocations: nextAllocations,
    },
    notice: repairNotice ?? undefined,
    events: [buildEvent(meta, "goal_spent", payload)],
  };
};

export const undoSpend = (
  state: NormalizedState,
  input: { payload: unknown },
  meta: EventMeta,
): DomainActionResult => {
  if (!isSpendEventPayload(input.payload)) {
    return { error: "Undo data is invalid." };
  }
  const payload = input.payload;
  const goal = findGoal(state, payload.goalId);
  if (!goal) {
    return { error: "Goal not found." };
  }
  if (!goal.spentAt) {
    return { error: "This goal is not marked as spent." };
  }
  if (goal.spentAt !== payload.spentAt) {
    return { error: "Spend record does not match the current goal state." };
  }
  const existingAllocations = state.allocations.some(
    (allocation) => allocation.goalId === payload.goalId,
  );
  if (existingAllocations) {
    return { error: "Allocations have changed and cannot be restored automatically." };
  }
  const nextPositions = state.positions.map((position) => {
    const payment = payload.payments.find((item) => item.positionId === position.id);
    if (!payment) {
      return position;
    }
    return {
      ...position,
      marketValue: position.marketValue + payment.amount,
      updatedAt: meta.createdAt,
    };
  });
  const existingKeys = new Set(
    state.allocations.map((allocation) => allocationKey(allocation.goalId, allocation.positionId)),
  );
  for (const allocation of payload.allocations) {
    if (existingKeys.has(allocationKey(allocation.goalId, allocation.positionId))) {
      return { error: "Allocations have changed and cannot be restored automatically." };
    }
  }
  const nextAllocations = [...state.allocations, ...payload.allocations];
  const nextGoal: Goal = { ...goal, spentAt: undefined };

  const baseState: NormalizedState = {
    ...state,
    goals: state.goals.map((item) => (item.id === goal.id ? nextGoal : item)),
    positions: nextPositions,
    allocations: nextAllocations,
  };
  const repairMeta: EventMeta = {
    eventId: `${meta.eventId}-repair`,
    createdAt: meta.createdAt,
  };
  const repair = repairStateOnLoad(baseState, repairMeta);

  return {
    nextState: repair.nextState,
    notice: repair.notice ?? undefined,
    events: [
      buildEvent(meta, "goal_spend_undone", {
        goalId: goal.id,
        goalName: goal.name,
        spentAt: payload.spentAt,
      }),
      ...repair.events,
    ],
  };
};
