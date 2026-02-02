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
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataContextValue, DomainActionOutcome } from "@/components/dataContext";
import {
  formatCurrency,
  formatIntegerInput,
  getIntegerInputError,
  parseIntegerInput,
} from "@/lib/numberFormat";
import type { Goal } from "@/lib/persistence/types";

type GoalTab = "details" | "allocations" | "history" | "spend";

type SaveFailureReason =
  | "offline"
  | "unauthenticated"
  | "read_only"
  | "invalid_space"
  | "no_snapshot"
  | "no_changes"
  | "missing_etag"
  | "conflict"
  | "error";

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US");
};

const isActiveGoal = (goal: Goal): boolean => goal.status === "active" && !goal.spentAt;

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
  return fallback ?? "Could not save changes.";
};

const parseRequiredInteger = (value: string): number | null => {
  const error = getIntegerInputError(value, { required: true });
  if (error) {
    return null;
  }
  return parseIntegerInput(value);
};

export function GoalsView({ data }: { data: DataContextValue }) {
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
    saveChanges,
    discardChanges,
    space,
  } = data;

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
  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

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
        const leftActive = isActiveGoal(left);
        const rightActive = isActiveGoal(right);
        if (leftActive !== rightActive) {
          return leftActive ? -1 : 1;
        }
        if (leftActive && rightActive) {
          if (left.priority !== right.priority) {
            return left.priority - right.priority;
          }
          return left.id.localeCompare(right.id);
        }
        return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
      }),
    [goals],
  );

  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [goalTab, setGoalTab] = useState<GoalTab>("details");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsHydrated(true), 0);
    return () => window.clearTimeout(timerId);
  }, []);

  const effectiveGoalId = useMemo(() => {
    if (selectedGoalId && goalsSorted.some((goal) => goal.id === selectedGoalId)) {
      return selectedGoalId;
    }
    return goalsSorted[0]?.id ?? null;
  }, [goalsSorted, selectedGoalId]);

  const selectedGoal = goals.find((goal) => goal.id === effectiveGoalId) ?? null;
  const selectedGoalSpent = Boolean(selectedGoal?.spentAt);
  const canEditSelectedGoal = canEdit && !selectedGoalSpent;

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

  const availablePositionsForGoal = useMemo(() => {
    if (!selectedGoal) {
      return [];
    }
    return positions.filter((position) => {
      return !selectedGoalAllocations.some((allocation) => allocation.positionId === position.id);
    });
  }, [positions, selectedGoal, selectedGoalAllocations]);

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
      setInfoMessage("Saved to OneDrive.");
    }
  };

  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTargetAmount, setNewGoalTargetAmount] = useState("0");
  const [newGoalPriority, setNewGoalPriority] = useState("1");
  const [newGoalStatus, setNewGoalStatus] = useState<"active" | "closed">("active");
  const [newGoalStartDate, setNewGoalStartDate] = useState("");
  const [newGoalEndDate, setNewGoalEndDate] = useState("");

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
      setNewGoalName("");
      setNewGoalTargetAmount("0");
      setNewGoalPriority("1");
      setNewGoalStatus("active");
      setNewGoalStartDate("");
      setNewGoalEndDate("");
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
    }
  };

  const [newAllocationPositionId, setNewAllocationPositionId] = useState<string | null>(null);
  const [newAllocationAmount, setNewAllocationAmount] = useState("0");
  const [allocationEdits, setAllocationEdits] = useState<Record<string, string>>({});
  const [allocationReductions, setAllocationReductions] = useState<Record<string, string>>({});

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setAllocationEdits({});
      setAllocationReductions({});
      setNewAllocationAmount("0");
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoal?.id]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setAllocationEdits((prev) => {
        const next: Record<string, string> = {};
        for (const allocation of selectedGoalAllocations) {
          next[allocation.id] =
            prev[allocation.id] ?? formatIntegerInput(allocation.allocatedAmount.toString());
        }
        return next;
      });
      setAllocationReductions((prev) => {
        const next: Record<string, string> = {};
        for (const allocation of selectedGoalAllocations) {
          next[allocation.id] = prev[allocation.id] ?? "0";
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoalAllocations]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      if (
        newAllocationPositionId &&
        availablePositionsForGoal.some((position) => position.id === newAllocationPositionId)
      ) {
        return;
      }
      setNewAllocationPositionId(availablePositionsForGoal[0]?.id ?? null);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoal?.id, availablePositionsForGoal, newAllocationPositionId]);

  const newAllocationAmountError = getIntegerInputError(newAllocationAmount, { required: true });

  const handleCreateAllocation = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal first.");
      return;
    }
    if (!newAllocationPositionId) {
      setErrorMessage("Select a position to allocate from.");
      return;
    }

    const amount = parseRequiredInteger(newAllocationAmount);
    if (amount === null) {
      setErrorMessage(newAllocationAmountError ?? "Enter a non-negative integer.");
      return;
    }
    if (amount === 0) {
      setErrorMessage("Allocated amount must be greater than zero.");
      return;
    }

    const persisted = await runMutation(
      () =>
        createAllocation({
          goalId: selectedGoal.id,
          positionId: newAllocationPositionId,
          allocatedAmount: amount,
        }),
      "Allocation added.",
    );

    if (persisted) {
      setNewAllocationAmount("0");
    }
  };

  const handleUpdateAllocation = async (allocationId: string) => {
    const amount = parseRequiredInteger(allocationEdits[allocationId] ?? "");
    if (amount === null) {
      setErrorMessage("Allocated amount must be a non-negative integer.");
      return;
    }

    await runMutation(() => updateAllocation(allocationId, amount), "Allocation updated.");
  };

  const handleDeleteAllocation = async (allocationId: string) => {
    await runMutation(() => deleteAllocation(allocationId), "Allocation deleted.");
  };

  const handleReduceAllocations = async () => {
    const reductions = selectedGoalAllocations.map((allocation) => {
      const raw = allocationReductions[allocation.id] ?? "0";
      const parsed = parseIntegerInput(raw);
      return {
        allocationId: allocation.id,
        amount: parsed ?? -1,
        currentAmount: allocation.allocatedAmount,
      };
    });

    const hasInvalid = reductions.some((item) => item.amount < 0);
    if (hasInvalid) {
      setErrorMessage("Reduction amounts must be non-negative integers.");
      return;
    }

    const exceedsCurrent = reductions.some((item) => item.amount > item.currentAmount);
    if (exceedsCurrent) {
      setErrorMessage("Reduction amounts cannot exceed current allocation amounts.");
      return;
    }

    await runMutation(
      () =>
        reduceAllocations(
          reductions.map((item) => ({
            allocationId: item.allocationId,
            amount: item.amount,
          })),
        ),
      "Allocations reduced.",
    );
  };

  const handleRemoveAllAllocations = async () => {
    if (selectedGoalAllocations.length === 0) {
      return;
    }

    await runMutation(
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

  const selectedGoalTotalAllocated = useMemo(
    () => selectedGoalAllocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0),
    [selectedGoalAllocations],
  );

  const [spendInputs, setSpendInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setSpendInputs({});
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoal?.id]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setSpendInputs((prev) => {
        const next: Record<string, string> = {};
        for (const allocation of selectedGoalAllocations) {
          next[allocation.id] =
            prev[allocation.id] ?? formatIntegerInput(allocation.allocatedAmount.toString());
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [selectedGoalAllocations]);

  const [undoInfo, setUndoInfo] = useState<{ available: boolean; message: string | null }>({
    available: false,
    message: null,
  });

  useEffect(() => {
    let isActive = true;
    const updateUndoInfo = () => {
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
    };

    const timerId = window.setTimeout(updateUndoInfo, 0);
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

    await runMutation(
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
  };

  const handleUndoSpend = async () => {
    if (!selectedGoal) {
      setErrorMessage("Select a goal to undo.");
      return;
    }

    await runMutation(() => undoSpend(selectedGoal.id), "Spend undone.");
  };

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const achievedSelectedGoal = useMemo(() => {
    if (!selectedGoal) {
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
      <section className="app-surface">
        <h1>Goals</h1>
        <p className="app-muted">
          {space.scope === "shared"
            ? "Manage shared goals and allocations."
            : "Manage savings goals and allocations."}
        </p>
        {space.scope === "shared" ? (
          <div className="app-muted">
            Shared space: {space.label} ({space.sharedId ?? "Unknown"})
          </div>
        ) : null}
      </section>

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
            {allocationNotice.changes.length > 0 ? (
              <div className="section-stack">
                {allocationNotice.changes.map((change) => {
                  const goalName = goalsById.get(change.goalId)?.name ?? "Unknown goal";
                  const positionName =
                    positionsById.get(change.positionId)?.label ?? "Unknown position";
                  return (
                    <div key={`${change.goalId}-${change.positionId}`}>
                      {goalName} · {positionName}: {formatCurrency(change.before)} →{" "}
                      {formatCurrency(change.after)}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="app-actions">
              <Button
                appearance="primary"
                onClick={() => {
                  setGoalTab("allocations");
                  if (allocationNotice.affectedGoalIds.length > 0) {
                    setSelectedGoalId(allocationNotice.affectedGoalIds[0]);
                  }
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
        <section className="app-surface goals-master-pane">
          <div className="goals-pane-header">
            <h2>Goal list</h2>
          </div>

          {goalsSorted.length === 0 ? (
            <div className="goals-empty-card">
              <h3>No goals yet</h3>
              <p className="app-muted">Create your first goal to start tracking progress.</p>
            </div>
          ) : (
            <div className="section-stack" role="listbox" aria-label="Goal list">
              {goalsSorted.map((goal) => {
                const allocated = allocationTotalsByGoal[goal.id] ?? 0;
                const ratio =
                  goal.targetAmount > 0 ? Math.min(1, allocated / goal.targetAmount) : 1;
                const achieved = allocated >= goal.targetAmount;
                const selected = selectedGoal?.id === goal.id;

                return (
                  <button
                    key={goal.id}
                    type="button"
                    className={`goals-master-item ${selected ? "goals-master-item-selected" : ""}`}
                    onClick={() => setSelectedGoalId(goal.id)}
                  >
                    <div className="goals-master-item-header">
                      <div className="goals-master-name">{goal.name}</div>
                      <div className="goals-status-group">
                        {achieved ? <span className="goals-status-badge">Achieved</span> : null}
                        {goal.spentAt ? (
                          <span className="goals-status-chip">Spent</span>
                        ) : (
                          <span className="goals-status-chip">{goal.status}</span>
                        )}
                      </div>
                    </div>
                    <div className="app-muted">Priority {goal.priority}</div>
                    <div className="goals-progress-row">
                      <span>
                        {formatCurrency(allocated)} / {formatCurrency(goal.targetAmount)}
                      </span>
                      <span>{Math.round(ratio * 100)}%</span>
                    </div>
                    <div className="goals-progress-bar" aria-hidden>
                      <div className="goals-progress-fill" style={{ width: `${ratio * 100}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="goals-create-card">
            <h3>Create goal</h3>
            <div className="section-stack">
              <Field label="Goal name">
                <Input
                  value={newGoalName}
                  onChange={(_, value) => setNewGoalName(value.value)}
                  placeholder="Emergency fund"
                  disabled={!canEdit || activity !== "idle"}
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
                Add goal
              </Button>
            </div>
          </div>
        </section>

        <section className="app-surface goals-detail-pane">
          {!selectedGoal ? (
            <div className="goals-empty-card">
              <h3>No goal selected</h3>
              <p className="app-muted">Select a goal from the list to view details.</p>
            </div>
          ) : (
            <div className="section-stack">
              <div className="goals-detail-header">
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

              <div className="goals-progress-bar" aria-hidden>
                <div
                  className="goals-progress-fill"
                  style={{
                    width: `${
                      selectedGoal.targetAmount > 0
                        ? Math.min(
                            100,
                            (selectedGoalTotalAllocated / selectedGoal.targetAmount) * 100,
                          )
                        : 100
                    }%`,
                  }}
                />
              </div>

              <TabList
                selectedValue={goalTab}
                onTabSelect={(_, value) => setGoalTab(value.value as GoalTab)}
              >
                <Tab value="details">Details</Tab>
                <Tab value="allocations">Allocations</Tab>
                <Tab value="history">History</Tab>
                <Tab value="spend">Spend</Tab>
              </TabList>

              {goalTab === "details" ? (
                <div className="section-stack">
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
                      placeholder="0 (JPY integer only)"
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
                      onChange={(_, value) => setEditGoalPriority(formatIntegerInput(value.value))}
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
                        This deletes the goal and all related allocations. This cannot be undone.
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

                  {selectedGoal.spentAt ? (
                    <div className="app-alert" role="status">
                      <div className="section-stack">
                        <Text>
                          This goal was marked as spent on {formatDateTime(selectedGoal.spentAt)}.
                        </Text>
                        <Text>Editing is disabled for spent goals.</Text>
                        <Text>Undo is unavailable if allocations were edited after spending.</Text>
                        {undoInfo.message ? <Text>{undoInfo.message}</Text> : null}
                        <div className="app-actions">
                          <Button
                            appearance="primary"
                            onClick={() => void handleUndoSpend()}
                            disabled={!canEdit || !undoInfo.available || activity !== "idle"}
                          >
                            Undo spend
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {goalTab === "allocations" ? (
                <div className="section-stack">
                  {selectedGoalAllocations.length === 0 ? (
                    <div className="app-muted">No allocations yet for this goal.</div>
                  ) : (
                    <div className="section-stack">
                      {selectedGoalAllocations.map((allocation) => {
                        const position = positionsById.get(allocation.positionId);
                        const account = position ? accountsById.get(position.accountId) : null;
                        const allocatedTotal =
                          allocationTotalsByPosition[allocation.positionId] ?? 0;
                        const available = position
                          ? Math.max(
                              0,
                              position.marketValue - (allocatedTotal - allocation.allocatedAmount),
                            )
                          : 0;

                        return (
                          <div key={allocation.id} className="app-surface goals-allocation-card">
                            <div className="goals-master-item-header">
                              <div style={{ fontWeight: 600 }}>
                                {position?.label ?? "Unknown position"}
                              </div>
                              <div className="app-muted">{account?.name ?? "Unknown account"}</div>
                            </div>
                            <div className="app-muted">Available {formatCurrency(available)}</div>

                            <Field label="Allocated amount (JPY)">
                              <Input
                                inputMode="numeric"
                                value={allocationEdits[allocation.id] ?? ""}
                                onChange={(_, value) =>
                                  setAllocationEdits((prev) => ({
                                    ...prev,
                                    [allocation.id]: formatIntegerInput(value.value),
                                  }))
                                }
                                disabled={!canEditSelectedGoal || activity !== "idle"}
                              />
                            </Field>

                            <Field
                              label={`Reduce amount (current ${formatCurrency(allocation.allocatedAmount)})`}
                            >
                              <Input
                                inputMode="numeric"
                                value={allocationReductions[allocation.id] ?? "0"}
                                onChange={(_, value) =>
                                  setAllocationReductions((prev) => ({
                                    ...prev,
                                    [allocation.id]: formatIntegerInput(value.value),
                                  }))
                                }
                                disabled={!canEditSelectedGoal || activity !== "idle"}
                              />
                            </Field>

                            <div className="app-actions">
                              <Button
                                appearance="primary"
                                onClick={() => void handleUpdateAllocation(allocation.id)}
                                disabled={!canEditSelectedGoal || activity !== "idle"}
                              >
                                Save allocation
                              </Button>
                              <Button
                                onClick={() => void handleDeleteAllocation(allocation.id)}
                                disabled={!canEditSelectedGoal || activity !== "idle"}
                              >
                                Delete allocation
                              </Button>
                            </div>
                          </div>
                        );
                      })}

                      <div className="app-actions">
                        <Button
                          appearance="primary"
                          onClick={() => void handleReduceAllocations()}
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        >
                          Apply reductions
                        </Button>
                        <Button
                          onClick={() => void handleRemoveAllAllocations()}
                          disabled={!canEditSelectedGoal || activity !== "idle"}
                        >
                          Remove all allocations
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="goals-create-card">
                    <h3>Add allocation</h3>
                    {positions.length === 0 ? (
                      <div className="app-muted">Create a position before adding allocations.</div>
                    ) : availablePositionsForGoal.length === 0 ? (
                      <div className="app-muted">
                        All positions are already allocated for this goal.
                      </div>
                    ) : (
                      <div className="section-stack">
                        <Field label="Position">
                          <Dropdown
                            selectedOptions={
                              newAllocationPositionId ? [newAllocationPositionId] : []
                            }
                            onOptionSelect={(_, value) =>
                              setNewAllocationPositionId(value.optionValue ?? null)
                            }
                            disabled={!canEditSelectedGoal || activity !== "idle"}
                          >
                            {availablePositionsForGoal.map((position) => {
                              const account = accountsById.get(position.accountId);
                              const allocated = allocationTotalsByPosition[position.id] ?? 0;
                              const available = Math.max(0, position.marketValue - allocated);
                              const optionText = `${position.label} · ${
                                account?.name ?? "Account"
                              } · Available ${formatCurrency(available)}`;

                              return (
                                <Option key={position.id} value={position.id} text={optionText}>
                                  {optionText}
                                </Option>
                              );
                            })}
                          </Dropdown>
                        </Field>

                        <Field
                          label="Allocated amount (JPY)"
                          validationState={newAllocationAmountError ? "error" : "none"}
                          validationMessage={newAllocationAmountError ?? undefined}
                        >
                          <Input
                            inputMode="numeric"
                            value={newAllocationAmount}
                            onChange={(_, value) =>
                              setNewAllocationAmount(formatIntegerInput(value.value))
                            }
                            disabled={!canEditSelectedGoal || activity !== "idle"}
                            placeholder="0 (JPY integer only)"
                          />
                        </Field>

                        <Button
                          appearance="primary"
                          onClick={() => void handleCreateAllocation()}
                          disabled={
                            !canEditSelectedGoal ||
                            activity !== "idle" ||
                            !newAllocationPositionId ||
                            !!newAllocationAmountError
                          }
                        >
                          Add allocation
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {goalTab === "history" ? (
                <div className="section-stack">
                  <div className="app-muted">
                    Open History to review activity for this goal. Data connection and pagination
                    will be added in Stage 5.
                  </div>
                  <div className="app-actions">
                    <Button appearance="primary" onClick={() => setHistoryDrawerOpen(true)}>
                      Open history
                    </Button>
                  </div>
                </div>
              ) : null}

              {goalTab === "spend" ? (
                <div className="section-stack">
                  {selectedGoal.spentAt ? (
                    <div className="app-muted">This goal is already marked as spent.</div>
                  ) : selectedGoal.status !== "closed" ? (
                    <div className="app-muted">Close the goal before marking it as spent.</div>
                  ) : selectedGoalAllocations.length === 0 ? (
                    <div className="app-muted">No allocations are available to spend.</div>
                  ) : (
                    <>
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

                      <Button
                        appearance="primary"
                        onClick={() => void handleSpendGoal()}
                        disabled={!canEditSelectedGoal || activity !== "idle"}
                      >
                        Mark as spent
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {historyDrawerOpen ? (
        <div className="goals-history-overlay" onClick={() => setHistoryDrawerOpen(false)}>
          <section
            className="goals-history-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Goal history"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="goals-history-header">
              <strong>{selectedGoal ? `${selectedGoal.name} · History` : "Goal history"}</strong>
              <Button onClick={() => setHistoryDrawerOpen(false)}>Close</Button>
            </header>
            <div className="section-stack">
              <Text>History is coming soon.</Text>
              <Text className="app-muted">This overlay is ready for Stage 5 data integration.</Text>
            </div>
          </section>
        </div>
      ) : null}

      {conflictDialogOpen ? (
        <div className="goals-history-overlay" onClick={() => setConflictDialogOpen(false)}>
          <section
            className="goals-history-drawer"
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
    </div>
  );
}
