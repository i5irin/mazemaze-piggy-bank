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

export type DomainActionResult =
  | { nextState: NormalizedState; events: PendingEvent[] }
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

const isNonEmptyString = (value: string): boolean => value.trim().length > 0;

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

const normalizeOptionalDate = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

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
    return left.id.localeCompare(right.id);
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
    updatedAt: meta.createdAt,
  };
  return {
    nextState: { ...state, positions: [...state.positions, position] },
    events: [
      buildEvent(meta, "position_created", {
        positionId: position.id,
        accountId: position.accountId,
        assetType: position.assetType,
        marketValue: position.marketValue,
      }),
    ],
  };
};

export const updatePosition = (
  state: NormalizedState,
  input: { id: string; assetType: AssetType; label: string; marketValue: number },
  meta: EventMeta,
): DomainActionResult => {
  const position = findPosition(state, input.id);
  if (!position) {
    return { error: "Position not found." };
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

  const marketValueChanged = position.marketValue !== input.marketValue;
  let nextAllocations = state.allocations;
  let recalculated = false;

  if (marketValueChanged) {
    if (position.marketValue > 0) {
      const positionAllocations = getAllocationsForPosition(state, position.id);
      const recalculatedAllocations = recalculateAllocations(
        positionAllocations,
        position.marketValue,
        input.marketValue,
      );
      const recalculatedById = new Map(
        recalculatedAllocations.map((allocation) => [allocation.id, allocation]),
      );
      nextAllocations = state.allocations.map(
        (allocation) => recalculatedById.get(allocation.id) ?? allocation,
      );
      recalculated = true;
    } else {
      const allocationTotal = getPositionAllocationTotal(state, position.id);
      if (allocationTotal > input.marketValue) {
        return { error: "Allocation total exceeds the position market value." };
      }
    }
  }

  const nextPosition: Position = {
    ...position,
    assetType: input.assetType,
    label: trimmedLabel,
    marketValue: input.marketValue,
    updatedAt: marketValueChanged ? meta.createdAt : position.updatedAt,
  };

  return {
    nextState: {
      ...state,
      positions: state.positions.map((item) => (item.id === position.id ? nextPosition : item)),
      allocations: nextAllocations,
    },
    events: [
      buildEvent(meta, "position_updated", {
        positionId: position.id,
        assetType: nextPosition.assetType,
        marketValue: nextPosition.marketValue,
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
  const nextGoal: Goal = {
    ...goal,
    name: trimmedName,
    targetAmount: input.targetAmount,
    priority: input.priority,
    status: input.status,
    startDate: normalizeOptionalDate(input.startDate),
    endDate: normalizeOptionalDate(input.endDate),
  };
  return {
    nextState: {
      ...state,
      goals: state.goals.map((item) => (item.id === goal.id ? nextGoal : item)),
    },
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
  if (!findGoal(state, input.goalId)) {
    return { error: "Goal not found." };
  }
  const position = findPosition(state, input.positionId);
  if (!position) {
    return { error: "Position not found." };
  }
  if (!isNonNegativeInteger(input.allocatedAmount)) {
    return { error: "Allocated amount must be a non-negative integer." };
  }
  if (
    state.allocations.some(
      (allocation) =>
        allocation.goalId === input.goalId && allocation.positionId === input.positionId,
    )
  ) {
    return { error: "Allocation already exists for this goal and position." };
  }
  const duplicateError = ensureUniqueId(state.allocations, input.id, "Allocation");
  if (duplicateError) {
    return { error: duplicateError };
  }
  const currentTotal = getPositionAllocationTotal(state, input.positionId);
  if (currentTotal + input.allocatedAmount > position.marketValue) {
    return { error: "Allocation total exceeds the position market value." };
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
  const position = findPosition(state, allocation.positionId);
  if (!position) {
    return { error: "Position not found." };
  }
  const currentTotal = getPositionAllocationTotal(state, allocation.positionId, allocation.id);
  if (currentTotal + input.allocatedAmount > position.marketValue) {
    return { error: "Allocation total exceeds the position market value." };
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

  const nextAllocations = state.allocations.map((allocation) => {
    const reduction = normalized.find((item) => item.allocation.id === allocation.id);
    if (!reduction) {
      return allocation;
    }
    return {
      ...allocation,
      allocatedAmount: allocation.allocatedAmount - reduction.amount,
    };
  });

  return {
    nextState: { ...state, allocations: nextAllocations },
    events: [
      buildEvent(meta, "allocations_reduced", {
        reductions: normalized.map((item) => ({
          allocationId: item.allocation.id,
          amount: item.amount,
        })),
      }),
    ],
  };
};
