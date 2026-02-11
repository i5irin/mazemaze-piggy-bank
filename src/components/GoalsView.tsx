"use client";

import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Tab,
  TabList,
  Text,
} from "@fluentui/react-components";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataContextValue, DomainActionOutcome } from "@/components/dataContext";
import { useStorageProviderContext } from "@/components/StorageProviderContext";
import {
  formatCurrency,
  formatIntegerInput,
  getIntegerInputError,
  parseIntegerInput,
} from "@/lib/numberFormat";
import type { HistoryItem } from "@/lib/persistence/history";
import type { Allocation, Goal } from "@/lib/persistence/types";
import { buildSharedRouteKey } from "@/lib/storage/sharedRoute";

type GoalFilter = "active" | "closed" | "spent";
type GoalTab = "details" | "allocations" | "history" | "receipt";

type SaveFailureReason =
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

type SpendEventPayload = {
  goalId: string;
  spentAt: string;
  totalAmount: number;
  payments: { positionId: string; amount: number }[];
};

const HISTORY_PAGE_SIZE = 20;

const isActiveGoal = (goal: Goal): boolean => goal.status === "active" && !goal.spentAt;
const isClosedGoal = (goal: Goal): boolean => goal.status === "closed" && !goal.spentAt;
const isSpentGoal = (goal: Goal): boolean => Boolean(goal.spentAt);
const isGoalTab = (value: string | null): value is GoalTab =>
  value === "details" || value === "allocations" || value === "history" || value === "receipt";

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US");
};

const formatDateOnly = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-US");
};

const toHistoryOriginLabel = (origin: HistoryItem["origin"]): string =>
  origin === "system" ? "System" : "User";

const getEditNotice = (data: DataContextValue): string | null => {
  if (!data.isOnline) {
    return "Offline mode is view-only. Connect to the internet to edit.";
  }
  if (!data.isSignedIn) {
    return "Sign in to edit. Offline mode is view-only.";
  }
  if (!data.canWrite) {
    return data.readOnlyReason;
  }
  return null;
};

const toSaveFailureMessage = (reason: SaveFailureReason, fallback?: string): string => {
  if (reason === "offline") {
    return "Offline mode is view-only. Please reconnect and try again.";
  }
  if (reason === "unauthenticated") {
    return "Sign in to save your changes.";
  }
  if (reason === "read_only") {
    return "This shared space is read-only.";
  }
  if (reason === "missing_etag") {
    return "Missing server version. Reload and try again.";
  }
  if (reason === "partial_failure") {
    return (
      fallback ??
      "Save partially failed: data was saved, but history upload failed. Retry is required."
    );
  }
  return fallback ?? "Could not save changes.";
};

const parseRequiredInteger = (value: string): number | null => {
  const error = getIntegerInputError(value, { required: true });
  if (error) {
    return null;
  }
  return parseIntegerInput(value);
};

const isSpendPayload = (value: unknown): value is SpendEventPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as SpendEventPayload;
  return (
    typeof payload.goalId === "string" &&
    typeof payload.spentAt === "string" &&
    typeof payload.totalAmount === "number" &&
    Array.isArray(payload.payments)
  );
};

export function GoalsView({ data }: { data: DataContextValue }) {
  const { activeProviderId } = useStorageProviderContext();
  const {
    draftState,
    isOnline,
    isSignedIn,
    canWrite,
    activity,
    createGoal,
    updateGoal,
    deleteGoal,
    createAllocation,
    updateAllocation,
    deleteAllocation,
    reduceAllocations,
    spendGoal,
    undoSpend,
    allocationNotice,
    clearAllocationNotice,
    latestEvent,
    loadHistoryPage,
    isRevalidating,
    saveChanges,
    discardChanges,
    space,
  } = data;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const canEdit = isOnline && isSignedIn && canWrite;
  const editNotice = getEditNotice(data);

  const goals = useMemo(() => draftState?.goals ?? [], [draftState?.goals]);
  const allocations = useMemo(() => draftState?.allocations ?? [], [draftState?.allocations]);
  const positions = useMemo(() => draftState?.positions ?? [], [draftState?.positions]);
  const accounts = useMemo(() => draftState?.accounts ?? [], [draftState?.accounts]);

  const positionsById = useMemo(
    () => new Map(positions.map((position) => [position.id, position])),
    [positions],
  );
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const allocationsByGoalPosition = useMemo(() => {
    const map = new Map<string, Allocation>();
    for (const allocation of allocations) {
      map.set(`${allocation.goalId}:${allocation.positionId}`, allocation);
    }
    return map;
  }, [allocations]);

  const allocationTotalsByGoal = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const allocation of allocations) {
      totals[allocation.goalId] = (totals[allocation.goalId] ?? 0) + allocation.allocatedAmount;
    }
    return totals;
  }, [allocations]);

  const allocationTotalsByPosition = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const allocation of allocations) {
      totals[allocation.positionId] =
        (totals[allocation.positionId] ?? 0) + allocation.allocatedAmount;
    }
    return totals;
  }, [allocations]);

  const goalsSorted = useMemo(
    () =>
      [...goals].sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        return left.id.localeCompare(right.id);
      }),
    [goals],
  );

  const [goalFilter, setGoalFilter] = useState<GoalFilter>("active");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsHydrated(true), 0);
    return () => window.clearTimeout(timerId);
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

  const filteredGoals = useMemo(() => {
    if (goalFilter === "active") {
      return goalsSorted.filter(isActiveGoal);
    }
    if (goalFilter === "closed") {
      return goalsSorted.filter(isClosedGoal);
    }
    return goalsSorted.filter(isSpentGoal);
  }, [goalFilter, goalsSorted]);

  const goalCounts = useMemo(
    () => ({
      active: goalsSorted.filter(isActiveGoal).length,
      closed: goalsSorted.filter(isClosedGoal).length,
      spent: goalsSorted.filter(isSpentGoal).length,
    }),
    [goalsSorted],
  );

  const updateGoalsQuery = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      const next = params.toString();
      router.replace(next.length > 0 ? `${pathname}?${next}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const normalizeTabForGoal = useCallback((value: string | null, goal: Goal | null): GoalTab => {
    const baseTab: GoalTab = isGoalTab(value) ? value : "details";
    if (baseTab === "receipt" && !goal?.spentAt) {
      return "details";
    }
    return baseTab;
  }, []);

  const queryGoalId = searchParams.get("goalId");
  const highlightGoalId = searchParams.get("highlightGoalId");
  const selectedGoal = goals.find((goal) => goal.id === queryGoalId) ?? null;
  const selectedGoalHistoryId = selectedGoal?.id ?? null;
  const selectedGoalTab = normalizeTabForGoal(searchParams.get("tab"), selectedGoal);
  const showGoalListPane = !isMobileViewport || !selectedGoal;
  const showGoalDetailPane = !isMobileViewport || Boolean(selectedGoal);
  const selectedGoalSpent = Boolean(selectedGoal?.spentAt);
  const canEditSelectedGoal = canEdit && !selectedGoalSpent;

  useEffect(() => {
    if (goalsSorted.length === 0) {
      if (searchParams.has("goalId") || searchParams.has("tab")) {
        updateGoalsQuery((params) => {
          params.delete("goalId");
          params.delete("tab");
        });
      }
      return;
    }

    if (!selectedGoal) {
      if (isMobileViewport) {
        if (searchParams.has("goalId") && queryGoalId) {
          updateGoalsQuery((params) => {
            params.delete("goalId");
            params.delete("tab");
          });
        }
        return;
      }
      const fallbackGoal = filteredGoals[0] ?? goalsSorted[0];
      if (!fallbackGoal) {
        return;
      }
      updateGoalsQuery((params) => {
        params.set("goalId", fallbackGoal.id);
        params.set("tab", normalizeTabForGoal(params.get("tab"), fallbackGoal));
      });
      return;
    }

    if (searchParams.get("tab") !== selectedGoalTab) {
      updateGoalsQuery((params) => {
        params.set("tab", selectedGoalTab);
      });
    }
  }, [
    filteredGoals,
    goalsSorted,
    normalizeTabForGoal,
    searchParams,
    queryGoalId,
    isMobileViewport,
    selectedGoal,
    selectedGoalTab,
    updateGoalsQuery,
  ]);

  const selectedGoalAllocations = useMemo(() => {
    if (!selectedGoal) {
      return [];
    }
    return allocations
      .filter((allocation) => allocation.goalId === selectedGoal.id)
      .sort((left, right) => {
        const leftLabel = positionsById.get(left.positionId)?.label ?? "";
        const rightLabel = positionsById.get(right.positionId)?.label ?? "";
        if (leftLabel !== rightLabel) {
          return leftLabel.localeCompare(rightLabel);
        }
        return left.positionId.localeCompare(right.positionId);
      });
  }, [allocations, positionsById, selectedGoal]);

  const selectedGoalTotalAllocated = useMemo(
    () => selectedGoalAllocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0),
    [selectedGoalAllocations],
  );

  const [recentlyAddedPositionId, setRecentlyAddedPositionId] = useState<string | null>(null);
  const [highlightedGoalId, setHighlightedGoalId] = useState<string | null>(null);
  const highlightConsumedRef = useRef<Set<string>>(new Set());
  const [highlightedAllocationPositionId, setHighlightedAllocationPositionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!highlightGoalId) {
      return;
    }
    if (highlightConsumedRef.current.has(highlightGoalId)) {
      return;
    }
    highlightConsumedRef.current.add(highlightGoalId);
    setHighlightedGoalId(highlightGoalId);
    const timerId = window.setTimeout(() => setHighlightedGoalId(null), 1800);
    return () => window.clearTimeout(timerId);
  }, [highlightGoalId]);

  useEffect(() => {
    if (!highlightedAllocationPositionId) {
      return;
    }
    const timerId = window.setTimeout(() => setHighlightedAllocationPositionId(null), 1800);
    return () => window.clearTimeout(timerId);
  }, [highlightedAllocationPositionId]);

  const selectedGoalAllocatedPositions = useMemo(() => {
    const rows = selectedGoalAllocations
      .map((allocation) => {
        const position = positionsById.get(allocation.positionId);
        if (!position) {
          return null;
        }
        return { allocation, position };
      })
      .filter((item): item is { allocation: Allocation; position: (typeof positions)[number] } =>
        Boolean(item),
      );
    return rows.sort((left, right) => {
      if (recentlyAddedPositionId) {
        if (
          left.position.id === recentlyAddedPositionId &&
          right.position.id !== recentlyAddedPositionId
        ) {
          return -1;
        }
        if (
          right.position.id === recentlyAddedPositionId &&
          left.position.id !== recentlyAddedPositionId
        ) {
          return 1;
        }
      }
      const leftAccount = accountsById.get(left.position.accountId)?.name ?? "";
      const rightAccount = accountsById.get(right.position.accountId)?.name ?? "";
      if (leftAccount !== rightAccount) {
        return leftAccount.localeCompare(rightAccount);
      }
      return left.position.label.localeCompare(right.position.label);
    });
  }, [accountsById, positionsById, recentlyAddedPositionId, selectedGoalAllocations]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);

  const saveChangesRef = useRef(saveChanges);
  const discardChangesRef = useRef(discardChanges);

  useEffect(() => {
    saveChangesRef.current = saveChanges;
    discardChangesRef.current = discardChanges;
  }, [discardChanges, saveChanges]);

  const persistOperation = async (expectChanges: boolean): Promise<boolean> => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    let outcome = await saveChangesRef.current();
    if (!outcome.ok && outcome.reason === "no_changes" && expectChanges) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      outcome = await saveChangesRef.current();
    }

    if (outcome.ok || (!expectChanges && outcome.reason === "no_changes")) {
      setRetryPending(false);
      setErrorMessage(null);
      return true;
    }

    if (outcome.reason === "conflict") {
      setRetryPending(false);
      setConflictDialogOpen(true);
      return false;
    }

    setRetryPending(true);
    if (outcome.reason === "no_changes") {
      setErrorMessage("Could not save changes. Please retry.");
      return false;
    }

    setErrorMessage(toSaveFailureMessage(outcome.reason as SaveFailureReason, outcome.error));
    return false;
  };

  const runMutation = async (
    apply: () => DomainActionOutcome,
    successMessage: string,
    options: { rollbackOnFailure?: boolean } = { rollbackOnFailure: true },
  ): Promise<boolean> => {
    const result = apply();
    if (!result.ok) {
      setErrorMessage(result.error);
      setInfoMessage(null);
      return false;
    }

    const persisted = await persistOperation(true);
    if (!persisted && options.rollbackOnFailure) {
      discardChangesRef.current();
      setInfoMessage(null);
      return false;
    }

    if (persisted) {
      setInfoMessage(successMessage);
      setErrorMessage(null);
    }

    return persisted;
  };

  const retrySave = async () => {
    const persisted = await persistOperation(false);
    if (persisted) {
      setRetryPending(false);
      setInfoMessage("Saved to cloud.");
    }
  };

  const [createGoalDrawerOpen, setCreateGoalDrawerOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTargetAmount, setNewGoalTargetAmount] = useState("0");
  const [newGoalPriority, setNewGoalPriority] = useState("1");
  const [newGoalStatus, setNewGoalStatus] = useState<"active" | "closed">("active");
  const [newGoalStartDate, setNewGoalStartDate] = useState("");
  const [newGoalEndDate, setNewGoalEndDate] = useState("");

  const resetCreateGoalForm = () => {
    setNewGoalName("");
    setNewGoalTargetAmount("0");
    setNewGoalPriority("1");
    setNewGoalStatus("active");
    setNewGoalStartDate("");
    setNewGoalEndDate("");
  };

  const newGoalTargetError = getIntegerInputError(newGoalTargetAmount, { required: true });
  const newGoalPriorityError = getIntegerInputError(newGoalPriority, { required: true });

  const handleCreateGoal = async () => {
    const targetAmount = parseRequiredInteger(newGoalTargetAmount);
    const priority = parseRequiredInteger(newGoalPriority);
    if (targetAmount === null) {
      setErrorMessage(newGoalTargetError ?? "Target amount must be a non-negative integer.");
      return;
    }
    if (priority === null) {
      setErrorMessage(newGoalPriorityError ?? "Priority must be a non-negative integer.");
      return;
    }

    const persisted = await runMutation(
      () =>
        createGoal({
          name: newGoalName,
          targetAmount,
          priority,
          status: newGoalStatus,
          startDate: newGoalStartDate,
          endDate: newGoalEndDate,
        }),
      "Goal created.",
    );

    if (persisted) {
      setCreateGoalDrawerOpen(false);
      resetCreateGoalForm();
      updateGoalsQuery((params) => {
        params.delete("goalId");
        params.delete("tab");
      });
    }
  };

  const [editGoalName, setEditGoalName] = useState("");
  const [editGoalTargetAmount, setEditGoalTargetAmount] = useState("0");
  const [editGoalPriority, setEditGoalPriority] = useState("1");
  const [editGoalStatus, setEditGoalStatus] = useState<"active" | "closed">("active");
  const [editGoalStartDate, setEditGoalStartDate] = useState("");
  const [editGoalEndDate, setEditGoalEndDate] = useState("");
  const [goalDeleteStep, setGoalDeleteStep] = useState<0 | 1>(0);

  const lastHydratedGoalIdRef = useRef<string | null>(null);
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const currentGoalId = selectedGoal?.id ?? null;
      if (currentGoalId === lastHydratedGoalIdRef.current) {
        return;
      }
      lastHydratedGoalIdRef.current = currentGoalId;

      if (!selectedGoal) {
        setEditGoalName("");
        setEditGoalTargetAmount("0");
        setEditGoalPriority("1");
        setEditGoalStatus("active");
        setEditGoalStartDate("");
        setEditGoalEndDate("");
        setGoalDeleteStep(0);
        return;
      }

      setEditGoalName(selectedGoal.name);
      setEditGoalTargetAmount(formatIntegerInput(selectedGoal.targetAmount.toString()));
      setEditGoalPriority(formatIntegerInput(selectedGoal.priority.toString()));
      setEditGoalStatus(selectedGoal.status);
      setEditGoalStartDate(selectedGoal.startDate ?? "");
      setEditGoalEndDate(selectedGoal.endDate ?? "");
      setGoalDeleteStep(0);
      setRecentlyAddedPositionId(null);
      setHighlightedAllocationPositionId(null);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoal]);

  const editGoalTargetError = getIntegerInputError(editGoalTargetAmount, { required: true });
  const editGoalPriorityError = getIntegerInputError(editGoalPriority, { required: true });

  const handleUpdateGoal = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal to edit.");
      return;
    }
    const targetAmount = parseRequiredInteger(editGoalTargetAmount);
    const priority = parseRequiredInteger(editGoalPriority);
    if (targetAmount === null) {
      setErrorMessage(editGoalTargetError ?? "Target amount must be a non-negative integer.");
      return;
    }
    if (priority === null) {
      setErrorMessage(editGoalPriorityError ?? "Priority must be a non-negative integer.");
      return;
    }

    await runMutation(
      () =>
        updateGoal({
          goalId: selectedGoal.id,
          name: editGoalName,
          targetAmount,
          priority,
          status: editGoalStatus,
          startDate: editGoalStartDate,
          endDate: editGoalEndDate,
        }),
      "Goal updated.",
    );
  };

  const handleDeleteGoal = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal to delete.");
      return;
    }
    const persisted = await runMutation(() => deleteGoal(selectedGoal.id), "Goal deleted.");
    if (persisted) {
      setGoalDeleteStep(0);
      updateGoalsQuery((params) => {
        params.delete("goalId");
        params.delete("tab");
      });
    }
  };

  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, string>>({});
  const allocationSavingRef = useRef<Set<string>>(new Set());
  const [editingAllocationPositionId, setEditingAllocationPositionId] = useState<string | null>(
    null,
  );
  const [addAllocationDrawerOpen, setAddAllocationDrawerOpen] = useState(false);
  const [addAllocationPositionId, setAddAllocationPositionId] = useState<string | null>(null);
  const [addAllocationAmount, setAddAllocationAmount] = useState("0");
  const [removeAllDialogOpen, setRemoveAllDialogOpen] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      if (!selectedGoal) {
        setAllocationDrafts({});
        return;
      }
      const nextDrafts: Record<string, string> = {};
      for (const position of positions) {
        const allocation = allocationsByGoalPosition.get(`${selectedGoal.id}:${position.id}`);
        nextDrafts[position.id] = formatIntegerInput((allocation?.allocatedAmount ?? 0).toString());
      }
      setAllocationDrafts(nextDrafts);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [allocationsByGoalPosition, positions, selectedGoal]);

  const addAllocationCandidates = useMemo(() => {
    if (!selectedGoal) {
      return [];
    }
    return positions
      .filter((position) => !allocationsByGoalPosition.has(`${selectedGoal.id}:${position.id}`))
      .map((position) => {
        const totalForPosition = allocationTotalsByPosition[position.id] ?? 0;
        const available = Math.max(0, position.marketValue - totalForPosition);
        const accountName = accountsById.get(position.accountId)?.name ?? "Unknown account";
        return { position, available, accountName };
      })
      .filter((item) => item.available > 0);
  }, [
    accountsById,
    allocationTotalsByPosition,
    allocationsByGoalPosition,
    positions,
    selectedGoal,
  ]);

  useEffect(() => {
    if (!addAllocationDrawerOpen) {
      return;
    }
    if (
      addAllocationPositionId &&
      addAllocationCandidates.some((candidate) => candidate.position.id === addAllocationPositionId)
    ) {
      return;
    }
    setAddAllocationPositionId(addAllocationCandidates[0]?.position.id ?? null);
  }, [addAllocationCandidates, addAllocationDrawerOpen, addAllocationPositionId]);

  const saveAllocationAbsolute = async (positionId: string) => {
    if (!selectedGoal || !canEditSelectedGoal || activity !== "idle") {
      return;
    }
    if (allocationSavingRef.current.has(positionId)) {
      return;
    }

    const raw = allocationDrafts[positionId] ?? "0";
    const amount = parseIntegerInput(raw);
    if (amount === null) {
      setErrorMessage("Allocation must be a non-negative integer.");
      return;
    }

    const existing = allocationsByGoalPosition.get(`${selectedGoal.id}:${positionId}`);
    const currentAmount = existing?.allocatedAmount ?? 0;
    if (amount === currentAmount) {
      return;
    }

    const totalForPosition = allocationTotalsByPosition[positionId] ?? 0;
    const maxForPosition = Math.max(0, totalForPosition - currentAmount);
    const position = positionsById.get(positionId);
    const available = position ? Math.max(0, position.marketValue - maxForPosition) : 0;
    const maxByGoal = Math.max(
      0,
      selectedGoal.targetAmount - (selectedGoalTotalAllocated - currentAmount),
    );
    const maxAllowed = Math.min(available, maxByGoal);

    if (amount > maxAllowed) {
      setErrorMessage("Allocation exceeds the available amount for this position or goal.");
      return;
    }

    allocationSavingRef.current.add(positionId);
    let persisted = false;
    if (existing) {
      persisted =
        amount === 0
          ? await runMutation(() => deleteAllocation(existing.id), "Allocation updated.")
          : await runMutation(() => updateAllocation(existing.id, amount), "Allocation updated.");
    } else {
      if (amount === 0) {
        allocationSavingRef.current.delete(positionId);
        return;
      }
      persisted = await runMutation(
        () =>
          createAllocation({
            goalId: selectedGoal.id,
            positionId,
            allocatedAmount: amount,
          }),
        "Allocation updated.",
      );
    }

    allocationSavingRef.current.delete(positionId);
    if (!persisted) {
      const fallback = existing?.allocatedAmount ?? 0;
      setAllocationDrafts((prev) => ({
        ...prev,
        [positionId]: formatIntegerInput(fallback.toString()),
      }));
    }
  };

  const handleAddAllocation = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal first.");
      return;
    }
    if (!addAllocationPositionId) {
      setErrorMessage("Select a position.");
      return;
    }
    const amount = parseRequiredInteger(addAllocationAmount);
    if (amount === null) {
      setErrorMessage("Allocation amount must be a non-negative integer.");
      return;
    }
    if (amount <= 0) {
      setErrorMessage("Allocation amount must be greater than zero.");
      return;
    }

    const candidate = addAllocationCandidates.find(
      (item) => item.position.id === addAllocationPositionId,
    );
    if (!candidate) {
      setErrorMessage("Position is not available for allocation.");
      return;
    }
    const remainingToTarget = Math.max(0, selectedGoal.targetAmount - selectedGoalTotalAllocated);
    const maxAllowed = Math.min(candidate.available, remainingToTarget);
    if (amount > maxAllowed) {
      setErrorMessage("Allocation exceeds available amount or remaining target.");
      return;
    }

    const persisted = await runMutation(
      () =>
        createAllocation({
          goalId: selectedGoal.id,
          positionId: candidate.position.id,
          allocatedAmount: amount,
        }),
      "Allocation added.",
    );
    if (persisted) {
      setAddAllocationDrawerOpen(false);
      setAddAllocationAmount("0");
      setAddAllocationPositionId(null);
      setRecentlyAddedPositionId(candidate.position.id);
      setHighlightedAllocationPositionId(candidate.position.id);
    }
  };

  const buildEditPositionHref = (positionId: string, accountId: string) => {
    const query = new URLSearchParams();
    query.set("drawer", "position");
    query.set("positionId", positionId);
    query.set("accountId", accountId);
    if (selectedGoal) {
      query.set("returnGoalId", selectedGoal.id);
      query.set("returnTab", "allocations");
    }
    if (space.scope === "shared" && space.sharedId) {
      return `/shared/${encodeURIComponent(
        buildSharedRouteKey(activeProviderId, space.sharedId),
      )}/accounts?${query.toString()}`;
    }
    return `/accounts?${query.toString()}`;
  };

  const addAllocationAmountError = getIntegerInputError(addAllocationAmount, { required: true });
  const selectedAddAllocationCandidate = addAllocationCandidates.find(
    (candidate) => candidate.position.id === addAllocationPositionId,
  );
  const remainingToTarget = selectedGoal
    ? Math.max(0, selectedGoal.targetAmount - selectedGoalTotalAllocated)
    : 0;

  const fabGoalDisabledReason = !canEdit
    ? (editNotice ?? "Sign in to edit.")
    : activity !== "idle"
      ? "Please wait until the current action finishes."
      : null;

  const fabAllocationDisabledReason = !selectedGoal
    ? "Open a goal and switch to Allocations to add one."
    : selectedGoalTab !== "allocations"
      ? "Open a goal and switch to Allocations to add one."
      : !canEditSelectedGoal
        ? selectedGoalSpent
          ? "Spent goals are read-only."
          : (editNotice ?? "Sign in to edit.")
        : activity !== "idle"
          ? "Please wait until the current action finishes."
          : null;

  const handleBackToGoalList = () => {
    setIsFabMenuOpen(false);
    updateGoalsQuery((params) => {
      params.delete("goalId");
      params.delete("tab");
    });
  };

  const openCreateGoalDrawer = () => {
    setIsFabMenuOpen(false);
    setCreateGoalDrawerOpen(true);
  };

  const openAddAllocationDrawer = () => {
    setIsFabMenuOpen(false);
    setAddAllocationDrawerOpen(true);
    setAddAllocationAmount("0");
  };

  const handleRemoveAllAllocations = async () => {
    if (selectedGoalAllocations.length === 0) {
      return false;
    }
    return runMutation(
      () =>
        reduceAllocations(
          selectedGoalAllocations.map((allocation) => ({
            allocationId: allocation.id,
            amount: allocation.allocatedAmount,
          })),
        ),
      "All allocations removed.",
    );
  };

  const [spendDrawerOpen, setSpendDrawerOpen] = useState(false);
  const [spendInputs, setSpendInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!selectedGoal || !spendDrawerOpen) {
      return;
    }
    const timerId = window.setTimeout(() => {
      const nextInputs: Record<string, string> = {};
      for (const allocation of selectedGoalAllocations) {
        nextInputs[allocation.id] = formatIntegerInput(allocation.allocatedAmount.toString());
      }
      setSpendInputs(nextInputs);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoal, selectedGoalAllocations, spendDrawerOpen]);

  const [undoInfo, setUndoInfo] = useState<{ available: boolean; message: string | null }>({
    available: false,
    message: null,
  });

  useEffect(() => {
    let isActive = true;
    const timerId = window.setTimeout(() => {
      if (!isActive) {
        return;
      }
      if (!selectedGoal || !selectedGoal.spentAt) {
        setUndoInfo({ available: false, message: null });
        return;
      }
      if (!latestEvent || latestEvent.type !== "goal_spent") {
        setUndoInfo({ available: false, message: "Only the most recent spend can be undone." });
        return;
      }
      const payload = latestEvent.payload as { goalId?: string; spentAt?: string } | undefined;
      if (!payload || payload.goalId !== selectedGoal.id) {
        setUndoInfo({ available: false, message: "Only the most recent spend can be undone." });
        return;
      }
      const spentAt = payload.spentAt ? new Date(payload.spentAt) : null;
      if (!spentAt || Number.isNaN(spentAt.getTime())) {
        setUndoInfo({ available: false, message: "Undo data is invalid." });
        return;
      }
      const elapsed = Date.now() - spentAt.getTime();
      if (elapsed > 24 * 60 * 60 * 1000) {
        setUndoInfo({
          available: false,
          message: "Undo is only available for 24 hours after spending.",
        });
        return;
      }
      setUndoInfo({
        available: true,
        message: "Undo is available for 24 hours after spending.",
      });
    }, 0);
    return () => {
      isActive = false;
      window.clearTimeout(timerId);
    };
  }, [latestEvent, selectedGoal]);

  const handleSpendGoal = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal to spend.");
      return;
    }

    const payments = selectedGoalAllocations.map((allocation) => {
      const amount = parseIntegerInput(spendInputs[allocation.id] ?? "");
      return {
        allocation,
        amount: amount ?? -1,
      };
    });

    if (payments.some((item) => item.amount < 0)) {
      setErrorMessage("Payment amounts must be non-negative integers.");
      return;
    }

    const paymentTotal = payments.reduce((sum, item) => sum + item.amount, 0);
    if (paymentTotal !== selectedGoalTotalAllocated) {
      setErrorMessage("Payments must total the goal allocation amount.");
      return;
    }

    if (payments.some((item) => item.amount > item.allocation.allocatedAmount)) {
      setErrorMessage("Payment amounts cannot exceed allocated amounts.");
      return;
    }

    const persisted = await runMutation(
      () =>
        spendGoal({
          goalId: selectedGoal.id,
          payments: payments.map((item) => ({
            positionId: item.allocation.positionId,
            amount: item.amount,
          })),
        }),
      "Goal marked as spent.",
    );

    if (persisted) {
      setSpendDrawerOpen(false);
      updateGoalsQuery((params) => {
        params.set("tab", "receipt");
      });
    }
  };

  const handleUndoSpend = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal to undo.");
      return;
    }
    const persisted = await runMutation(() => undoSpend(selectedGoal.id), "Spend undone.");
    if (persisted) {
      updateGoalsQuery((params) => {
        params.set("tab", "details");
      });
    }
  };

  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestSeqRef = useRef(0);

  const loadInitialHistory = useCallback(
    async (goalId: string) => {
      const requestId = historyRequestSeqRef.current + 1;
      historyRequestSeqRef.current = requestId;
      setHistoryItems([]);
      setHistoryCursor(null);
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = await loadHistoryPage({
          limit: HISTORY_PAGE_SIZE,
          filter: { goalId },
        });
        if (historyRequestSeqRef.current !== requestId) {
          return;
        }
        setHistoryItems(page.items);
        setHistoryCursor(page.nextCursor);
      } catch (err) {
        if (historyRequestSeqRef.current !== requestId) {
          return;
        }
        setHistoryItems([]);
        setHistoryCursor(null);
        setHistoryError(err instanceof Error ? err.message : "Could not load history.");
      } finally {
        if (historyRequestSeqRef.current === requestId) {
          setHistoryLoading(false);
        }
      }
    },
    [loadHistoryPage],
  );

  const loadMoreHistory = useCallback(async () => {
    if (!selectedGoalHistoryId || !historyCursor) {
      return;
    }
    const requestId = historyRequestSeqRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await loadHistoryPage({
        limit: HISTORY_PAGE_SIZE,
        cursor: historyCursor,
        filter: { goalId: selectedGoalHistoryId },
      });
      if (historyRequestSeqRef.current !== requestId) {
        return;
      }
      setHistoryItems((prev) => [...prev, ...page.items]);
      setHistoryCursor(page.nextCursor);
    } catch (err) {
      if (historyRequestSeqRef.current === requestId) {
        setHistoryError(err instanceof Error ? err.message : "Could not load more history.");
      }
    } finally {
      if (historyRequestSeqRef.current === requestId) {
        setHistoryLoading(false);
      }
    }
  }, [historyCursor, loadHistoryPage, selectedGoalHistoryId]);

  useEffect(() => {
    if (!selectedGoalHistoryId || selectedGoalTab !== "history") {
      historyRequestSeqRef.current += 1;
      setHistoryItems([]);
      setHistoryCursor(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    void loadInitialHistory(selectedGoalHistoryId);
  }, [loadInitialHistory, selectedGoalHistoryId, selectedGoalTab]);

  const receipt = useMemo(() => {
    if (!selectedGoal?.spentAt || !latestEvent || latestEvent.type !== "goal_spent") {
      return null;
    }
    if (!isSpendPayload(latestEvent.payload)) {
      return null;
    }
    if (latestEvent.payload.goalId !== selectedGoal.id) {
      return null;
    }
    if (latestEvent.payload.spentAt !== selectedGoal.spentAt) {
      return null;
    }
    return latestEvent.payload;
  }, [latestEvent, selectedGoal]);

  const achievedSelectedGoal = useMemo(() => {
    if (!selectedGoal || selectedGoal.spentAt) {
      return false;
    }
    return selectedGoalTotalAllocated >= selectedGoal.targetAmount;
  }, [selectedGoal, selectedGoalTotalAllocated]);

  if (!isHydrated) {
    return (
      <div className="section-stack goals-page">
        <section className="app-surface">
          <h1>Goals</h1>
          <p className="app-muted">Loading goals...</p>
        </section>
      </div>
    );
  }

  return (
    <div className="section-stack goals-page">
      {editNotice ? (
        <div className="app-alert" role="status">
          <Text>{editNotice}</Text>
        </div>
      ) : null}

      {infoMessage ? (
        <div className="app-alert" role="status">
          <Text>{infoMessage}</Text>
        </div>
      ) : null}

      {isRevalidating ? (
        <div className="app-alert" role="status">
          <Text>Refreshing...</Text>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>{errorMessage}</Text>
          {retryPending ? (
            <div className="app-actions" style={{ marginTop: 8 }}>
              <Button onClick={() => void retrySave()} disabled={activity !== "idle"}>
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {allocationNotice ? (
        <div className="app-alert app-alert-warning" role="status">
          <div className="section-stack">
            <Text>Allocations were adjusted to keep your data consistent.</Text>
            {allocationNotice.requiresDirectEdit ? (
              <Text>
                Manual allocation review required. {allocationNotice.directReasons.join(" ")}
              </Text>
            ) : null}
            <div className="app-actions">
              <Button
                appearance="primary"
                onClick={() => {
                  const affectedGoalId = allocationNotice.affectedGoalIds[0];
                  updateGoalsQuery((params) => {
                    params.set("tab", "allocations");
                    if (affectedGoalId) {
                      params.set("goalId", affectedGoalId);
                    }
                  });
                }}
              >
                Review allocations
              </Button>
              <Button onClick={clearAllocationNotice}>Dismiss</Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="goals-layout">
        {showGoalListPane ? (
          <section className="app-surface goals-master-pane">
            <div className="goals-pane-header">
              <h2>Goal list</h2>
              <Button
                className="goals-desktop-only"
                appearance="primary"
                size="small"
                onClick={openCreateGoalDrawer}
                disabled={!canEdit || activity !== "idle"}
              >
                Add goal
              </Button>
            </div>

            <div className="goals-filter-row" role="tablist" aria-label="Goal filters">
              {(
                [
                  ["active", "Active"],
                  ["closed", "Closed"],
                  ["spent", "Spent"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`goals-filter-chip ${goalFilter === value ? "goals-filter-chip-active" : ""}`}
                  onClick={() => setGoalFilter(value)}
                  role="tab"
                  aria-selected={goalFilter === value}
                >
                  <span>{label}</span>
                  <span className="goals-filter-count">{goalCounts[value]}</span>
                </button>
              ))}
            </div>

            {filteredGoals.length === 0 ? (
              <div className="goals-empty-card">
                <h3>No {goalFilter} goals</h3>
                <p className="app-muted">
                  {goalsSorted.length === 0
                    ? "Create your first goal to start tracking progress."
                    : "Try another filter or create a new goal."}
                </p>
                {goalsSorted.length === 0 ? (
                  <Button
                    className="goals-desktop-only"
                    appearance="primary"
                    onClick={openCreateGoalDrawer}
                    disabled={!canEdit || activity !== "idle"}
                  >
                    Add goal
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="section-stack" role="listbox" aria-label="Goal list">
                {filteredGoals.map((goal) => {
                  const allocated = allocationTotalsByGoal[goal.id] ?? 0;
                  const ratio =
                    goal.targetAmount > 0 ? Math.min(1, allocated / goal.targetAmount) : 1;
                  const achieved = allocated >= goal.targetAmount;
                  const selected = selectedGoal?.id === goal.id;
                  const highlighted = highlightedGoalId === goal.id;
                  const spent = Boolean(goal.spentAt);

                  return (
                    <button
                      key={goal.id}
                      type="button"
                      className={`goals-master-item ${selected ? "goals-master-item-selected" : ""} ${highlighted ? "goals-master-item-highlight" : ""}`}
                      onClick={() => {
                        setIsFabMenuOpen(false);
                        updateGoalsQuery((params) => {
                          params.set("goalId", goal.id);
                          params.set("tab", normalizeTabForGoal(params.get("tab"), goal));
                        });
                      }}
                    >
                      <div className="goals-master-item-header">
                        <div className="goals-master-name">{goal.name}</div>
                        <div className="goals-status-group">
                          {achieved && !spent ? (
                            <span className="goals-status-badge">Achieved</span>
                          ) : null}
                          {spent ? (
                            <span className="goals-status-chip">Spent</span>
                          ) : goal.status === "closed" ? (
                            <span className="goals-status-chip">Closed</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="app-muted">Priority {goal.priority}</div>

                      {spent ? (
                        <div className="app-muted">
                          Spent on {formatDateOnly(goal.spentAt ?? "")}
                        </div>
                      ) : (
                        <>
                          <div className="goals-progress-row">
                            <span>
                              {formatCurrency(allocated)} / {formatCurrency(goal.targetAmount)}
                            </span>
                            <span>{Math.round(ratio * 100)}%</span>
                          </div>
                          <div className="goals-progress-bar" aria-hidden>
                            <div
                              className="goals-progress-fill"
                              style={{ width: `${ratio * 100}%` }}
                            />
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {showGoalDetailPane ? (
          <section className="app-surface goals-detail-pane">
            {!selectedGoal ? (
              <div className="goals-empty-card">
                <h3>No goal selected</h3>
                <p className="app-muted">Select a goal from the list to view details.</p>
              </div>
            ) : (
              <div className="goals-detail-shell">
                <div className="goals-detail-sticky">
                  <div className="goals-detail-header">
                    <div className="goals-mobile-only">
                      <Button appearance="secondary" size="small" onClick={handleBackToGoalList}>
                        Back
                      </Button>
                    </div>
                    <div>
                      <h2>{selectedGoal.name}</h2>
                      <div className="goals-status-group">
                        {achievedSelectedGoal ? (
                          <span className="goals-status-badge">Achieved</span>
                        ) : null}
                        {selectedGoal.spentAt ? (
                          <span className="goals-status-chip">Spent</span>
                        ) : (
                          <span className="goals-status-chip">{selectedGoal.status}</span>
                        )}
                      </div>
                    </div>
                    <div className="goals-progress-meta">
                      <div>
                        {formatCurrency(selectedGoalTotalAllocated)} /{" "}
                        {formatCurrency(selectedGoal.targetAmount)}
                      </div>
                      <div className="app-muted">Priority {selectedGoal.priority}</div>
                    </div>
                  </div>

                  <div className="goals-header-actions">
                    {selectedGoal.spentAt ? (
                      <Button
                        appearance="primary"
                        onClick={() => void handleUndoSpend()}
                        disabled={!canEdit || !undoInfo.available || activity !== "idle"}
                      >
                        Undo spend
                      </Button>
                    ) : selectedGoal.status === "closed" ? (
                      <Button
                        appearance="primary"
                        onClick={() => setSpendDrawerOpen(true)}
                        disabled={!canEdit || activity !== "idle"}
                      >
                        Mark as spent...
                      </Button>
                    ) : null}
                  </div>

                  <TabList
                    selectedValue={selectedGoalTab}
                    onTabSelect={(_, value) => {
                      const nextTab = value.value as GoalTab;
                      updateGoalsQuery((params) => {
                        params.set("tab", nextTab);
                      });
                    }}
                  >
                    <Tab value="details">Details</Tab>
                    <Tab value="allocations">Allocations</Tab>
                    <Tab value="history">History</Tab>
                    {selectedGoal.spentAt ? <Tab value="receipt">Receipt</Tab> : null}
                  </TabList>
                </div>

                <div className="goals-detail-content">
                  {selectedGoalTab === "details" ? (
                    <div className="section-stack">
                      {achievedSelectedGoal && !selectedGoal.spentAt ? (
                        <div className="app-alert" role="status">
                          <div className="section-stack">
                            <Text>This goal reached 100% of the target.</Text>
                            <div className="app-actions">
                              {selectedGoal.status === "active" ? (
                                <Button
                                  onClick={() =>
                                    void runMutation(
                                      () =>
                                        updateGoal({
                                          goalId: selectedGoal.id,
                                          name: selectedGoal.name,
                                          targetAmount: selectedGoal.targetAmount,
                                          priority: selectedGoal.priority,
                                          status: "closed",
                                          startDate: selectedGoal.startDate,
                                          endDate: selectedGoal.endDate,
                                        }),
                                      "Goal closed.",
                                    )
                                  }
                                  disabled={!canEditSelectedGoal || activity !== "idle"}
                                >
                                  Close goal
                                </Button>
                              ) : (
                                <Button
                                  onClick={() => setSpendDrawerOpen(true)}
                                  disabled={!canEditSelectedGoal || activity !== "idle"}
                                >
                                  Mark as spent...
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <Field label="Goal name">
                        <Input
                          value={editGoalName}
                          onChange={(_, value) => setEditGoalName(value.value)}
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        />
                      </Field>

                      <Field
                        label="Target amount (JPY)"
                        validationState={editGoalTargetError ? "error" : "none"}
                        validationMessage={editGoalTargetError ?? undefined}
                      >
                        <Input
                          inputMode="numeric"
                          value={editGoalTargetAmount}
                          onChange={(_, value) =>
                            setEditGoalTargetAmount(formatIntegerInput(value.value))
                          }
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        />
                      </Field>

                      <Field
                        label="Priority"
                        validationState={editGoalPriorityError ? "error" : "none"}
                        validationMessage={editGoalPriorityError ?? undefined}
                      >
                        <Input
                          inputMode="numeric"
                          value={editGoalPriority}
                          onChange={(_, value) =>
                            setEditGoalPriority(formatIntegerInput(value.value))
                          }
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        />
                      </Field>

                      <Field label="Status">
                        <Dropdown
                          selectedOptions={[editGoalStatus]}
                          onOptionSelect={(_, value) => {
                            const status = value.optionValue as "active" | "closed" | undefined;
                            if (status) {
                              setEditGoalStatus(status);
                            }
                          }}
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        >
                          <Option value="active">Active</Option>
                          <Option value="closed">Closed</Option>
                        </Dropdown>
                      </Field>

                      <Field label="Start date (optional)">
                        <Input
                          type="date"
                          value={editGoalStartDate}
                          onChange={(_, value) => setEditGoalStartDate(value.value)}
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        />
                      </Field>

                      <Field label="End date (optional)">
                        <Input
                          type="date"
                          value={editGoalEndDate}
                          onChange={(_, value) => setEditGoalEndDate(value.value)}
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        />
                      </Field>

                      <div className="app-actions">
                        <Button
                          appearance="primary"
                          onClick={() => void handleUpdateGoal()}
                          disabled={
                            !canEditSelectedGoal ||
                            activity !== "idle" ||
                            !!editGoalTargetError ||
                            !!editGoalPriorityError ||
                            editGoalName.trim().length === 0
                          }
                        >
                          Save goal
                        </Button>

                        {goalDeleteStep === 0 ? (
                          <Button
                            onClick={() => setGoalDeleteStep(1)}
                            disabled={!canEditSelectedGoal || activity !== "idle"}
                          >
                            Delete goal
                          </Button>
                        ) : null}
                      </div>

                      {goalDeleteStep === 1 ? (
                        <div className="app-alert app-alert-error" role="alert">
                          <Text>
                            This deletes the goal and all related allocations. This cannot be
                            undone.
                          </Text>
                          <div className="app-actions" style={{ marginTop: 12 }}>
                            <Button
                              appearance="primary"
                              onClick={() => void handleDeleteGoal()}
                              disabled={!canEditSelectedGoal || activity !== "idle"}
                            >
                              Delete permanently
                            </Button>
                            <Button onClick={() => setGoalDeleteStep(0)}>Cancel</Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {selectedGoalTab === "allocations" ? (
                    <div className="section-stack">
                      <div className="goals-allocation-toolbar">
                        <div className="goals-allocation-actions goals-desktop-only">
                          <Button
                            appearance="primary"
                            onClick={openAddAllocationDrawer}
                            disabled={!canEditSelectedGoal || activity !== "idle"}
                          >
                            + Add allocation
                          </Button>
                          <Button
                            appearance="secondary"
                            onClick={() => setRemoveAllDialogOpen(true)}
                            disabled={
                              !canEditSelectedGoal ||
                              activity !== "idle" ||
                              selectedGoalAllocations.length === 0
                            }
                          >
                            Remove all allocations
                          </Button>
                        </div>
                        <div className="goals-allocation-actions goals-mobile-only">
                          <Button
                            appearance="secondary"
                            onClick={() => setRemoveAllDialogOpen(true)}
                            disabled={
                              !canEditSelectedGoal ||
                              activity !== "idle" ||
                              selectedGoalAllocations.length === 0
                            }
                          >
                            Remove all allocations
                          </Button>
                        </div>
                      </div>

                      {selectedGoalAllocatedPositions.length === 0 ? (
                        <div className="goals-empty-card">
                          <h3>No allocations yet</h3>
                          <p className="app-muted">
                            Use + Add allocation to assign funds from positions.
                          </p>
                          <Button
                            appearance="primary"
                            onClick={openAddAllocationDrawer}
                            disabled={!canEditSelectedGoal || activity !== "idle"}
                          >
                            Add allocation
                          </Button>
                        </div>
                      ) : (
                        selectedGoalAllocatedPositions.map(({ allocation, position }) => {
                          const currentAmount = allocation.allocatedAmount;
                          const totalForPosition = allocationTotalsByPosition[position.id] ?? 0;
                          const available = Math.max(
                            0,
                            position.marketValue - (totalForPosition - currentAmount),
                          );
                          const maxByGoal = Math.max(
                            0,
                            selectedGoal.targetAmount -
                              (selectedGoalTotalAllocated - currentAmount),
                          );
                          const maxAllowed = Math.min(available, maxByGoal);
                          const draftRaw = allocationDrafts[position.id] ?? "0";
                          const draftAmount = parseIntegerInput(draftRaw) ?? 0;
                          const nextUnallocated = Math.max(
                            0,
                            position.marketValue - (totalForPosition - currentAmount + draftAmount),
                          );
                          const showAfterChangeHint =
                            editingAllocationPositionId === position.id ||
                            draftAmount !== currentAmount;
                          const accountName =
                            accountsById.get(position.accountId)?.name ?? "Unknown account";
                          const isHighlighted = highlightedAllocationPositionId === position.id;

                          return (
                            <div
                              key={position.id}
                              className={`app-surface goals-allocation-row ${isHighlighted ? "goals-allocation-row-highlight" : ""}`}
                            >
                              <div className="goals-master-item-header">
                                <div>
                                  <div className="goals-master-name">{position.label}</div>
                                  <div className="app-muted">{accountName}</div>
                                </div>
                                <div className="app-muted">
                                  Available {formatCurrency(available)}
                                </div>
                              </div>

                              <Field
                                label="Allocation (JPY)"
                                validationState={
                                  getIntegerInputError(draftRaw, { required: true }) ||
                                  draftAmount > maxAllowed
                                    ? "error"
                                    : "none"
                                }
                                validationMessage={
                                  getIntegerInputError(draftRaw, { required: true }) ??
                                  (draftAmount > maxAllowed
                                    ? "Allocation exceeds the available amount for this position or goal."
                                    : undefined)
                                }
                              >
                                <Input
                                  inputMode="numeric"
                                  value={draftRaw}
                                  onFocus={() => setEditingAllocationPositionId(position.id)}
                                  onChange={(_, value) =>
                                    setAllocationDrafts((prev) => ({
                                      ...prev,
                                      [position.id]: formatIntegerInput(value.value),
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      setEditingAllocationPositionId(null);
                                      void saveAllocationAbsolute(position.id);
                                    }
                                  }}
                                  onBlur={() => {
                                    setEditingAllocationPositionId((prev) =>
                                      prev === position.id ? null : prev,
                                    );
                                    void saveAllocationAbsolute(position.id);
                                  }}
                                  disabled={!canEditSelectedGoal || activity !== "idle"}
                                  placeholder="0 (JPY integer only)"
                                />
                              </Field>

                              <div className="goals-allocation-meta">
                                {showAfterChangeHint ? (
                                  <span className="app-muted">
                                    After change: Unallocated {formatCurrency(nextUnallocated)}
                                  </span>
                                ) : null}
                                <Button
                                  size="small"
                                  appearance="secondary"
                                  className="goals-allocation-edit-button"
                                  onClick={() =>
                                    router.push(
                                      buildEditPositionHref(position.id, position.accountId),
                                    )
                                  }
                                >
                                  ✏️ Edit
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}

                  {selectedGoalTab === "history" ? (
                    <div className="section-stack">
                      <div className="app-muted">Source: cloud event log.</div>

                      {historyError ? (
                        <div className="app-alert app-alert-error">{historyError}</div>
                      ) : null}

                      {historyLoading && historyItems.length === 0 ? (
                        <div className="app-muted">Loading history from cloud...</div>
                      ) : null}

                      {historyItems.length === 0 && !historyLoading ? (
                        <div className="goals-empty-card">
                          <h3>{historyCursor ? "Load more history" : "No history yet"}</h3>
                          <p className="app-muted">
                            {historyCursor
                              ? "No matching entries in recent chunks. Use Load more to continue."
                              : "No history entries match this goal yet."}
                          </p>
                        </div>
                      ) : (
                        <div className="section-stack">
                          {historyItems.map((item) => (
                            <div key={item.id} className="goals-history-item">
                              <div className="goals-master-item-header">
                                <div className="history-event-header">
                                  <strong>{item.eventType}</strong>
                                  <span
                                    className={`history-origin-badge ${
                                      item.origin === "system"
                                        ? "history-origin-badge-system"
                                        : "history-origin-badge-user"
                                    }`}
                                  >
                                    {toHistoryOriginLabel(item.origin)}
                                  </span>
                                </div>
                                <span className="app-muted">{formatDateTime(item.timestamp)}</span>
                              </div>
                              <div>{item.summary}</div>
                              {typeof item.amountDelta === "number" ? (
                                <div className="app-muted">{formatCurrency(item.amountDelta)}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="app-actions">
                        <Button
                          onClick={() => void loadMoreHistory()}
                          disabled={!historyCursor || historyLoading}
                        >
                          Load more
                        </Button>
                        {historyLoading ? <span className="app-muted">Loading...</span> : null}
                      </div>
                    </div>
                  ) : null}

                  {selectedGoalTab === "receipt" && selectedGoal.spentAt ? (
                    <div className="section-stack">
                      <div className="app-surface goals-receipt-card">
                        <div className="goals-master-item-header">
                          <strong>Spent on {formatDateOnly(selectedGoal.spentAt)}</strong>
                          <span className="goals-status-chip">Receipt</span>
                        </div>

                        {receipt ? (
                          <>
                            <div>Total spent: {formatCurrency(receipt.totalAmount)}</div>
                            <div className="section-stack">
                              {receipt.payments.map((payment, index) => {
                                const position = positionsById.get(payment.positionId);
                                return (
                                  <div
                                    key={`${payment.positionId}-${index}`}
                                    className="goals-receipt-row"
                                  >
                                    <span>{position?.label ?? "Unknown position"}</span>
                                    <span>{formatCurrency(payment.amount)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="app-muted">
                            Receipt details are unavailable in the current cache.
                          </div>
                        )}
                      </div>

                      <div className="app-alert" role="status">
                        <Text>
                          {undoInfo.message ??
                            "Undo is only available for 24 hours after spending."}
                        </Text>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>

      <div className="goals-mobile-fab">
        <Button
          appearance="primary"
          className="goals-mobile-fab-button"
          onClick={() => setIsFabMenuOpen((open) => !open)}
          aria-label="Open add menu"
        >
          +
        </Button>
        {isFabMenuOpen ? (
          <div className="goals-mobile-fab-menu">
            <Button
              onClick={openCreateGoalDrawer}
              disabled={!!fabGoalDisabledReason}
              title={fabGoalDisabledReason ?? undefined}
            >
              🎯 Goal
            </Button>
            <Button
              onClick={openAddAllocationDrawer}
              disabled={!!fabAllocationDisabledReason}
              title={fabAllocationDisabledReason ?? undefined}
            >
              ➕ Allocation
            </Button>
            {fabAllocationDisabledReason ? (
              <div className="app-muted goals-mobile-fab-reason">{fabAllocationDisabledReason}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      {addAllocationDrawerOpen ? (
        <div className="goals-overlay" onClick={() => setAddAllocationDrawerOpen(false)}>
          <section
            className="goals-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Add allocation"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="goals-drawer-header">
              <strong>Add allocation</strong>
              <Button onClick={() => setAddAllocationDrawerOpen(false)}>Close</Button>
            </header>

            {!selectedGoal ? (
              <div className="app-muted">Select a goal first.</div>
            ) : addAllocationCandidates.length === 0 ? (
              <div className="goals-empty-card">
                <h3>No available positions</h3>
                <p className="app-muted">
                  Every position is already allocated or has no available amount.
                </p>
              </div>
            ) : (
              <div className="section-stack">
                <Field label="Position">
                  <Dropdown
                    selectedOptions={addAllocationPositionId ? [addAllocationPositionId] : []}
                    onOptionSelect={(_, value) =>
                      setAddAllocationPositionId(value.optionValue ?? null)
                    }
                    disabled={!canEditSelectedGoal || activity !== "idle"}
                  >
                    {addAllocationCandidates.map((candidate) => {
                      const text = `${candidate.position.label} · ${candidate.accountName} · Available ${formatCurrency(candidate.available)}`;
                      return (
                        <Option
                          key={candidate.position.id}
                          value={candidate.position.id}
                          text={text}
                        >
                          {text}
                        </Option>
                      );
                    })}
                  </Dropdown>
                </Field>

                <Field
                  label="Amount (JPY)"
                  validationState={addAllocationAmountError ? "error" : "none"}
                  validationMessage={addAllocationAmountError ?? undefined}
                >
                  <Input
                    inputMode="numeric"
                    value={addAllocationAmount}
                    onChange={(_, value) => setAddAllocationAmount(formatIntegerInput(value.value))}
                    disabled={!canEditSelectedGoal || activity !== "idle"}
                    placeholder="0 (JPY integer only)"
                  />
                </Field>

                <div className="app-muted">
                  Available:{" "}
                  {selectedAddAllocationCandidate
                    ? formatCurrency(selectedAddAllocationCandidate.available)
                    : "—"}
                </div>
                <div className="app-muted">
                  Remaining to target: {formatCurrency(remainingToTarget)}
                </div>

                <div className="app-actions">
                  <Button
                    appearance="primary"
                    onClick={() => void handleAddAllocation()}
                    disabled={
                      !canEditSelectedGoal ||
                      activity !== "idle" ||
                      !addAllocationPositionId ||
                      !!addAllocationAmountError
                    }
                  >
                    Add allocation
                  </Button>
                  <Button onClick={() => setAddAllocationDrawerOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {createGoalDrawerOpen ? (
        <div className="goals-overlay" onClick={() => setCreateGoalDrawerOpen(false)}>
          <section
            className="goals-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Create goal"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="goals-drawer-header">
              <strong>New goal</strong>
              <Button onClick={() => setCreateGoalDrawerOpen(false)}>Close</Button>
            </header>

            <div className="section-stack">
              <Field label="Goal name">
                <Input
                  value={newGoalName}
                  onChange={(_, value) => setNewGoalName(value.value)}
                  disabled={!canEdit || activity !== "idle"}
                  placeholder="Emergency fund"
                />
              </Field>

              <Field
                label="Target amount (JPY)"
                validationState={newGoalTargetError ? "error" : "none"}
                validationMessage={newGoalTargetError ?? undefined}
              >
                <Input
                  inputMode="numeric"
                  value={newGoalTargetAmount}
                  onChange={(_, value) => setNewGoalTargetAmount(formatIntegerInput(value.value))}
                  disabled={!canEdit || activity !== "idle"}
                  placeholder="0 (JPY integer only)"
                />
              </Field>

              <Field
                label="Priority"
                validationState={newGoalPriorityError ? "error" : "none"}
                validationMessage={newGoalPriorityError ?? undefined}
              >
                <Input
                  inputMode="numeric"
                  value={newGoalPriority}
                  onChange={(_, value) => setNewGoalPriority(formatIntegerInput(value.value))}
                  disabled={!canEdit || activity !== "idle"}
                />
              </Field>

              <Field label="Status">
                <Dropdown
                  selectedOptions={[newGoalStatus]}
                  onOptionSelect={(_, value) => {
                    const status = value.optionValue as "active" | "closed" | undefined;
                    if (status) {
                      setNewGoalStatus(status);
                    }
                  }}
                  disabled={!canEdit || activity !== "idle"}
                >
                  <Option value="active">Active</Option>
                  <Option value="closed">Closed</Option>
                </Dropdown>
              </Field>

              <Field label="Start date (optional)">
                <Input
                  type="date"
                  value={newGoalStartDate}
                  onChange={(_, value) => setNewGoalStartDate(value.value)}
                  disabled={!canEdit || activity !== "idle"}
                />
              </Field>

              <Field label="End date (optional)">
                <Input
                  type="date"
                  value={newGoalEndDate}
                  onChange={(_, value) => setNewGoalEndDate(value.value)}
                  disabled={!canEdit || activity !== "idle"}
                />
              </Field>

              <div className="app-actions">
                <Button
                  appearance="primary"
                  onClick={() => void handleCreateGoal()}
                  disabled={
                    !canEdit ||
                    activity !== "idle" ||
                    !!newGoalTargetError ||
                    !!newGoalPriorityError ||
                    newGoalName.trim().length === 0
                  }
                >
                  Create goal
                </Button>
                <Button
                  onClick={() => {
                    resetCreateGoalForm();
                    setCreateGoalDrawerOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {spendDrawerOpen ? (
        <div className="goals-overlay" onClick={() => setSpendDrawerOpen(false)}>
          <section
            className="goals-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Mark as spent"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="goals-drawer-header">
              <strong>Mark as spent</strong>
              <Button onClick={() => setSpendDrawerOpen(false)}>Close</Button>
            </header>

            {!selectedGoal ? (
              <div className="app-muted">Select a goal first.</div>
            ) : (
              <div className="section-stack">
                <div className="app-muted">
                  Enter payment amounts per position. The total must match the goal allocation.
                </div>
                <div>Total to spend: {formatCurrency(selectedGoalTotalAllocated)}</div>

                {selectedGoalAllocations.map((allocation) => {
                  const position = positionsById.get(allocation.positionId);
                  return (
                    <Field
                      key={allocation.id}
                      label={`Pay from ${position?.label ?? "Position"} (allocated ${formatCurrency(
                        allocation.allocatedAmount,
                      )})`}
                    >
                      <Input
                        inputMode="numeric"
                        value={spendInputs[allocation.id] ?? "0"}
                        onChange={(_, value) =>
                          setSpendInputs((prev) => ({
                            ...prev,
                            [allocation.id]: formatIntegerInput(value.value),
                          }))
                        }
                        disabled={!canEditSelectedGoal || activity !== "idle"}
                      />
                    </Field>
                  );
                })}

                <div className="app-alert" role="status">
                  <Text>
                    {undoInfo.message ?? "Undo is only available for 24 hours after spending."}
                  </Text>
                </div>

                <div className="app-actions">
                  <Button
                    appearance="primary"
                    onClick={() => void handleSpendGoal()}
                    disabled={!canEditSelectedGoal || activity !== "idle"}
                  >
                    Confirm spend
                  </Button>
                  <Button onClick={() => setSpendDrawerOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {conflictDialogOpen ? (
        <div className="goals-overlay" onClick={() => setConflictDialogOpen(false)}>
          <section
            className="goals-drawer goals-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Couldn’t save</h3>
            <p>Data was updated elsewhere. Reloaded the latest data.</p>
            <div className="app-actions">
              <Button appearance="primary" onClick={() => setConflictDialogOpen(false)}>
                OK
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {removeAllDialogOpen ? (
        <div className="goals-overlay" onClick={() => setRemoveAllDialogOpen(false)}>
          <section
            className="goals-drawer goals-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Remove all allocations?</h3>
            <p>This will set all allocations for this goal to ¥0.</p>
            <div className="app-actions">
              <Button onClick={() => setRemoveAllDialogOpen(false)}>Cancel</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  void handleRemoveAllAllocations().then((persisted) => {
                    if (persisted) {
                      setRemoveAllDialogOpen(false);
                    }
                  });
                }}
                disabled={!canEditSelectedGoal || activity !== "idle"}
              >
                Remove
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
