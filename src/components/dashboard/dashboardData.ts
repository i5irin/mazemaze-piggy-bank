import type { AllocationNotice } from "@/lib/persistence/domain";
import type { PendingEvent } from "@/lib/persistence/eventChunk";
import type { Account, Allocation, Goal, NormalizedState, Position } from "@/lib/persistence/types";
export { formatCurrency } from "@/lib/numberFormat";

export type DashboardTotals = {
  totalAssets: number | null;
  allocated: number | null;
  unallocated: number | null;
  activeTargetTotal: number | null;
  activeAllocatedTotal: number | null;
};

export type GoalProgressItem = {
  id: string;
  name: string;
  targetAmount: number;
  allocatedAmount: number;
  progressRatio: number;
};

export type AccountSummaryItem = {
  id: string;
  name: string;
  total: number;
  free: number;
  positionCount: number;
};

export type AssetSummaryItem = {
  assetType: Position["assetType"];
  label: string;
  total: number;
  ratio: number;
  color: string;
};

export type RecentPositionItem = {
  id: string;
  label: string;
  accountId: string;
  marketValue: number;
  updatedAt: string;
};

export type RecentChangeItem = {
  title: string;
  detail: string;
  timestamp: string | null;
};

const ASSET_TYPE_LABELS: Record<Position["assetType"], string> = {
  cash: "Cash",
  deposit: "Deposit",
  fx: "FX",
  securities: "Securities",
  crypto: "Crypto",
  payout: "Insurance",
  stored: "Stored Value",
  other: "Other",
};

const EVENT_LABELS: Record<string, string> = {
  account_created: "Account created",
  account_updated: "Account updated",
  account_deleted: "Account deleted",
  position_created: "Position created",
  position_updated: "Position updated",
  position_deleted: "Position deleted",
  goal_created: "Goal created",
  goal_updated: "Goal updated",
  goal_deleted: "Goal deleted",
  allocation_created: "Allocation created",
  allocation_updated: "Allocation updated",
  allocation_deleted: "Allocation deleted",
  allocations_reduced: "Allocations reduced",
  state_repaired: "Data repaired",
  goal_spent: "Goal marked as spent",
  goal_spend_undone: "Goal spend undone",
};

const ASSET_COLORS = ["#F6E58D", "#d9b36f", "#b9854a", "#8a5b2d", "#6b4a2a"];
const MAX_ASSET_SEGMENTS = 4;

const sumBy = <T>(items: T[], pick: (item: T) => number): number =>
  items.reduce((total, item) => total + pick(item), 0);

const isGoalActive = (goal: Goal): boolean => goal.status === "active" && !goal.spentAt;

export const formatPercent = (ratio: number | null): string => {
  if (ratio === null) {
    return "—";
  }
  return `${Math.round(ratio * 100)}%`;
};

export const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export const buildDashboardTotals = (state: NormalizedState | null): DashboardTotals => {
  if (!state) {
    return {
      totalAssets: null,
      allocated: null,
      unallocated: null,
      activeTargetTotal: null,
      activeAllocatedTotal: null,
    };
  }
  const totalAssets = sumBy(state.positions, (position) => position.marketValue);
  const allocated = sumBy(state.allocations, (allocation) => allocation.allocatedAmount);
  const unallocated = Math.max(0, totalAssets - allocated);

  const activeGoals = state.goals.filter(isGoalActive);
  const activeTargetTotal = sumBy(activeGoals, (goal) => goal.targetAmount);
  const allocationByGoal = state.allocations.reduce<Record<string, number>>((acc, allocation) => {
    acc[allocation.goalId] = (acc[allocation.goalId] ?? 0) + allocation.allocatedAmount;
    return acc;
  }, {});
  const activeAllocatedTotal = sumBy(activeGoals, (goal) => allocationByGoal[goal.id] ?? 0);

  return { totalAssets, allocated, unallocated, activeTargetTotal, activeAllocatedTotal };
};

export const buildGoalProgress = (state: NormalizedState | null): GoalProgressItem[] => {
  if (!state) {
    return [];
  }
  const allocationByGoal = state.allocations.reduce<Record<string, number>>((acc, allocation) => {
    acc[allocation.goalId] = (acc[allocation.goalId] ?? 0) + allocation.allocatedAmount;
    return acc;
  }, {});
  return state.goals
    .filter(isGoalActive)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .map((goal) => {
      const allocatedAmount = allocationByGoal[goal.id] ?? 0;
      const progressRatio = goal.targetAmount > 0 ? allocatedAmount / goal.targetAmount : 0;
      return {
        id: goal.id,
        name: goal.name,
        targetAmount: goal.targetAmount,
        allocatedAmount,
        progressRatio,
      };
    });
};

export const buildAccountSummary = (
  accounts: Account[],
  positions: Position[],
  allocations: Allocation[],
): AccountSummaryItem[] => {
  if (accounts.length === 0) {
    return [];
  }
  const allocationByPosition = allocations.reduce<Record<string, number>>((acc, allocation) => {
    acc[allocation.positionId] = (acc[allocation.positionId] ?? 0) + allocation.allocatedAmount;
    return acc;
  }, {});
  return accounts
    .map((account) => {
      const positionsForAccount = positions.filter((position) => position.accountId === account.id);
      const total = sumBy(positionsForAccount, (position) => position.marketValue);
      const free = sumBy(positionsForAccount, (position) => {
        const allocated = allocationByPosition[position.id] ?? 0;
        return Math.max(0, position.marketValue - allocated);
      });
      return {
        id: account.id,
        name: account.name,
        total,
        free,
        positionCount: positionsForAccount.length,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
};

export const buildAssetSummary = (positions: Position[]): AssetSummaryItem[] => {
  if (positions.length === 0) {
    return [];
  }
  const totals = positions.reduce<Record<Position["assetType"], number>>(
    (acc, position) => {
      acc[position.assetType] = (acc[position.assetType] ?? 0) + position.marketValue;
      return acc;
    },
    {
      cash: 0,
      deposit: 0,
      fx: 0,
      securities: 0,
      crypto: 0,
      payout: 0,
      stored: 0,
      other: 0,
    },
  );

  const totalValue = Object.values(totals).reduce((sum, value) => sum + value, 0);

  const entries = (Object.keys(totals) as Position["assetType"][])
    .map((assetType) => ({
      assetType,
      label: ASSET_TYPE_LABELS[assetType],
      total: totals[assetType],
    }))
    .filter((item) => item.total > 0)
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));

  let items = entries;
  if (entries.length > MAX_ASSET_SEGMENTS) {
    const keepCount = Math.max(1, MAX_ASSET_SEGMENTS - 1);
    const top = entries.slice(0, keepCount);
    const rest = entries.slice(keepCount);
    const otherTotal = rest.reduce((sum, item) => sum + item.total, 0);
    if (otherTotal > 0) {
      const existingOther = top.find((item) => item.assetType === "other");
      if (existingOther) {
        existingOther.total += otherTotal;
      } else {
        top.push({ assetType: "other", label: "Other", total: otherTotal });
      }
    }
    items = top;
  }

  const withRatios = items.map((item) => ({
    ...item,
    ratio: totalValue > 0 ? item.total / totalValue : 0,
  }));

  return withRatios
    .sort((left, right) => {
      const leftOther = left.assetType === "other";
      const rightOther = right.assetType === "other";
      if (leftOther !== rightOther) {
        return leftOther ? 1 : -1;
      }
      return right.total - left.total || left.label.localeCompare(right.label);
    })
    .map((item, index) => ({
      ...item,
      color: ASSET_COLORS[index % ASSET_COLORS.length],
    }));
};

export const buildRecentPositions = (positions: Position[], limit = 5): RecentPositionItem[] =>
  [...positions]
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
      }
      return rightTime - leftTime || left.id.localeCompare(right.id);
    })
    .slice(0, limit)
    .map((position) => ({
      id: position.id,
      label: position.label,
      accountId: position.accountId,
      marketValue: position.marketValue,
      updatedAt: position.updatedAt,
    }));

export const buildRecentChange = (event: PendingEvent | null): RecentChangeItem | null => {
  if (!event) {
    return null;
  }
  const title = EVENT_LABELS[event.type] ?? "Recent change";
  return {
    title,
    detail: event.type,
    timestamp: event.createdAt,
  };
};

export const buildAlertSummary = (notice: AllocationNotice | null): string | null => {
  if (!notice) {
    return null;
  }
  if (notice.reason === "goal_target_reduce") {
    return "Allocations adjusted after a goal target update.";
  }
  if (notice.reason === "integrity_repair") {
    return "Allocations adjusted to repair data integrity.";
  }
  if (notice.reason === "spend_repair") {
    return "Allocations adjusted after undoing a spend.";
  }
  return "Allocations adjusted automatically.";
};

export const getAssetLabel = (assetType: Position["assetType"]): string =>
  ASSET_TYPE_LABELS[assetType] ?? "Other";

export const getProgressRatio = (totals: DashboardTotals): number | null => {
  if (totals.activeTargetTotal === null || totals.activeAllocatedTotal === null) {
    return null;
  }
  if (totals.activeTargetTotal === 0) {
    return 0;
  }
  return totals.activeAllocatedTotal / totals.activeTargetTotal;
};
