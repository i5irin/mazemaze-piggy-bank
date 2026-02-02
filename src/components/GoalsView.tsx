"use client";

import { Button, Dropdown, Field, Input, Option, Text } from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";
import type { DataContextValue } from "@/components/dataContext";
import type { Account, Allocation, Goal, Position } from "@/lib/persistence/types";
import { formatCurrency, parseIntegerInput } from "@/lib/numberFormat";

const buildAllocationDefaults = (allocations: Allocation[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const allocation of allocations) {
    values[allocation.id] = allocation.allocatedAmount.toString();
  }
  return values;
};

const buildReductionDefaults = (allocations: Allocation[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const allocation of allocations) {
    values[allocation.id] = "0";
  }
  return values;
};

const buildSpendDefaults = (allocations: Allocation[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const allocation of allocations) {
    values[allocation.id] = allocation.allocatedAmount.toString();
  }
  return values;
};

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US");
};

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

const isActiveGoal = (goal: Goal): boolean => goal.status === "active" && !goal.spentAt;

const GoalDetailsPanel = ({
  goal,
  canEdit,
  onUpdate,
  onDelete,
}: {
  goal: Goal;
  canEdit: boolean;
  onUpdate: (input: {
    name: string;
    targetAmount: string;
    priority: string;
    status: "active" | "closed";
    startDate: string;
    endDate: string;
  }) => void;
  onDelete: () => void;
}) => {
  const [editGoalName, setEditGoalName] = useState(goal.name);
  const [editGoalTargetAmount, setEditGoalTargetAmount] = useState(goal.targetAmount.toString());
  const [editGoalPriority, setEditGoalPriority] = useState(goal.priority.toString());
  const [editGoalStatus, setEditGoalStatus] = useState<"active" | "closed">(goal.status);
  const [editGoalStartDate, setEditGoalStartDate] = useState(goal.startDate ?? "");
  const [editGoalEndDate, setEditGoalEndDate] = useState(goal.endDate ?? "");
  const [goalDeleteStep, setGoalDeleteStep] = useState<0 | 1>(0);

  return (
    <div className="section-stack">
      <div>
        <div className="app-muted">Selected goal</div>
        <div style={{ fontWeight: 600 }}>{goal.name}</div>
      </div>
      <Field label="Goal name">
        <Input
          value={editGoalName}
          onChange={(_, data) => setEditGoalName(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <Field label="Target amount (JPY)">
        <Input
          type="number"
          inputMode="numeric"
          value={editGoalTargetAmount}
          onChange={(_, data) => setEditGoalTargetAmount(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <Field label="Priority">
        <Input
          type="number"
          inputMode="numeric"
          value={editGoalPriority}
          onChange={(_, data) => setEditGoalPriority(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <Field label="Status">
        <Dropdown
          selectedOptions={[editGoalStatus]}
          onOptionSelect={(_, data) => {
            const value = data.optionValue as "active" | "closed" | undefined;
            if (value) {
              setEditGoalStatus(value);
            }
          }}
          disabled={!canEdit}
        >
          <Option value="active">Active</Option>
          <Option value="closed">Closed</Option>
        </Dropdown>
      </Field>
      <Field label="Start date (optional)">
        <Input
          type="date"
          value={editGoalStartDate}
          onChange={(_, data) => setEditGoalStartDate(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <Field label="End date (optional)">
        <Input
          type="date"
          value={editGoalEndDate}
          onChange={(_, data) => setEditGoalEndDate(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <div className="app-actions">
        <Button
          onClick={() =>
            onUpdate({
              name: editGoalName,
              targetAmount: editGoalTargetAmount,
              priority: editGoalPriority,
              status: editGoalStatus,
              startDate: editGoalStartDate,
              endDate: editGoalEndDate,
            })
          }
          disabled={!canEdit}
        >
          Save goal
        </Button>
        {goalDeleteStep === 0 ? (
          <Button onClick={() => setGoalDeleteStep(1)} disabled={!canEdit}>
            Delete goal
          </Button>
        ) : null}
      </div>
      {goalDeleteStep === 1 ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>This deletes the goal and all related allocations. This cannot be undone.</Text>
          <div className="app-actions" style={{ marginTop: 12 }}>
            <Button appearance="primary" onClick={onDelete} disabled={!canEdit}>
              Delete permanently
            </Button>
            <Button onClick={() => setGoalDeleteStep(0)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const GoalAllocationsPanel = ({
  goal,
  positions,
  allocations,
  positionsById,
  accountsById,
  allocationTotalsByPosition,
  canEdit,
  reportOutcome,
  setPageError,
  createAllocation,
  updateAllocation,
  deleteAllocation,
  reduceAllocations,
}: {
  goal: Goal;
  positions: Position[];
  allocations: Allocation[];
  positionsById: Map<string, Position>;
  accountsById: Map<string, Account>;
  allocationTotalsByPosition: Record<string, number>;
  canEdit: boolean;
  reportOutcome: (result: { ok: boolean; error?: string }, message: string) => boolean;
  setPageError: (message: string | null) => void;
  createAllocation: (input: { goalId: string; positionId: string; allocatedAmount: number }) => {
    ok: boolean;
    error?: string;
  };
  updateAllocation: (
    allocationId: string,
    allocatedAmount: number,
  ) => {
    ok: boolean;
    error?: string;
  };
  deleteAllocation: (allocationId: string) => { ok: boolean; error?: string };
  reduceAllocations: (reductions: { allocationId: string; amount: number }[]) => {
    ok: boolean;
    error?: string;
  };
}) => {
  const allocationsForGoal = useMemo(() => {
    return allocations
      .filter((allocation) => allocation.goalId === goal.id)
      .sort((left, right) => {
        const leftLabel = positionsById.get(left.positionId)?.label ?? "";
        const rightLabel = positionsById.get(right.positionId)?.label ?? "";
        if (leftLabel !== rightLabel) {
          return leftLabel.localeCompare(rightLabel);
        }
        return left.positionId.localeCompare(right.positionId);
      });
  }, [allocations, goal.id, positionsById]);

  const availablePositionsForGoal = useMemo(() => {
    return positions.filter((position) => {
      return !allocationsForGoal.some((allocation) => allocation.positionId === position.id);
    });
  }, [allocationsForGoal, positions]);

  const [newAllocationPositionId, setNewAllocationPositionId] = useState<string | null>(null);
  const [newAllocationAmount, setNewAllocationAmount] = useState("0");

  const effectiveNewAllocationPositionId = useMemo(() => {
    if (
      newAllocationPositionId &&
      availablePositionsForGoal.some((position) => position.id === newAllocationPositionId)
    ) {
      return newAllocationPositionId;
    }
    return availablePositionsForGoal[0]?.id ?? null;
  }, [availablePositionsForGoal, newAllocationPositionId]);

  const defaultEdits = useMemo(
    () => buildAllocationDefaults(allocationsForGoal),
    [allocationsForGoal],
  );
  const defaultReductions = useMemo(
    () => buildReductionDefaults(allocationsForGoal),
    [allocationsForGoal],
  );

  const [allocationEdits, setAllocationEdits] = useState<Record<string, string>>({});
  const [allocationReductions, setAllocationReductions] = useState<Record<string, string>>({});

  const mergedEdits = useMemo(
    () => ({ ...defaultEdits, ...allocationEdits }),
    [allocationEdits, defaultEdits],
  );
  const mergedReductions = useMemo(
    () => ({ ...defaultReductions, ...allocationReductions }),
    [allocationReductions, defaultReductions],
  );

  const handleCreateAllocation = () => {
    if (!effectiveNewAllocationPositionId) {
      setPageError("Select a position to allocate from.");
      return;
    }
    const amount = parseIntegerInput(newAllocationAmount);
    if (amount === null) {
      setPageError("Allocated amount must be a non-negative integer.");
      return;
    }
    if (amount === 0) {
      setPageError("Allocated amount must be greater than zero.");
      return;
    }
    const result = createAllocation({
      goalId: goal.id,
      positionId: effectiveNewAllocationPositionId,
      allocatedAmount: amount,
    });
    if (reportOutcome(result, "Allocation created in draft.")) {
      setNewAllocationAmount("0");
    }
  };

  const handleUpdateAllocation = (allocationId: string) => {
    const value = mergedEdits[allocationId] ?? "";
    const amount = parseIntegerInput(value);
    if (amount === null) {
      setPageError("Allocated amount must be a non-negative integer.");
      return;
    }
    reportOutcome(updateAllocation(allocationId, amount), "Allocation updated in draft.");
  };

  const handleDeleteAllocation = (allocationId: string) => {
    reportOutcome(deleteAllocation(allocationId), "Allocation deleted in draft.");
  };

  const handleReduceAllocations = () => {
    const reductions = allocationsForGoal.map((allocation) => {
      const raw = mergedReductions[allocation.id] ?? "0";
      if (raw.trim().length === 0) {
        return { allocationId: allocation.id, amount: 0 };
      }
      const amount = parseIntegerInput(raw);
      return { allocationId: allocation.id, amount: amount ?? -1 };
    });
    const hasInvalid = reductions.some((item) => item.amount < 0);
    if (hasInvalid) {
      setPageError("Reduction amounts must be non-negative integers.");
      return;
    }
    reportOutcome(reduceAllocations(reductions), "Allocations reduced in draft.");
  };

  return (
    <div className="section-stack">
      {allocationsForGoal.length === 0 ? (
        <div className="app-muted">No allocations yet for this goal.</div>
      ) : (
        <div className="section-stack">
          {allocationsForGoal.map((allocation) => {
            const position = positionsById.get(allocation.positionId);
            const account = position ? accountsById.get(position.accountId) : null;
            const allocatedTotal = allocationTotalsByPosition[allocation.positionId] ?? 0;
            const available = position
              ? Math.max(0, position.marketValue - (allocatedTotal - allocation.allocatedAmount))
              : 0;
            return (
              <div key={allocation.id} className="app-surface">
                <div style={{ fontWeight: 600 }}>{position?.label ?? "Unknown position"}</div>
                <div className="app-muted">
                  {account?.name ?? "Unknown account"} · Available {formatCurrency(available)}
                </div>
                <Field label="Allocated amount (JPY)">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={mergedEdits[allocation.id] ?? ""}
                    onChange={(_, data) =>
                      setAllocationEdits((prev) => ({
                        ...prev,
                        [allocation.id]: data.value,
                      }))
                    }
                    disabled={!canEdit}
                  />
                </Field>
                <div className="app-actions">
                  <Button onClick={() => handleUpdateAllocation(allocation.id)} disabled={!canEdit}>
                    Save allocation
                  </Button>
                  <Button onClick={() => handleDeleteAllocation(allocation.id)} disabled={!canEdit}>
                    Delete allocation
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="app-surface">
        <h3>Add allocation</h3>
        {positions.length === 0 ? (
          <div className="app-muted">Create a position before adding allocations.</div>
        ) : availablePositionsForGoal.length === 0 ? (
          <div className="app-muted">All positions are already allocated for this goal.</div>
        ) : (
          <div className="section-stack">
            <Field label="Position">
              <Dropdown
                selectedOptions={
                  effectiveNewAllocationPositionId ? [effectiveNewAllocationPositionId] : []
                }
                onOptionSelect={(_, data) => setNewAllocationPositionId(data.optionValue ?? null)}
                disabled={!canEdit}
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
            <Field label="Allocated amount (JPY)">
              <Input
                type="number"
                inputMode="numeric"
                value={newAllocationAmount}
                onChange={(_, data) => setNewAllocationAmount(data.value)}
                disabled={!canEdit}
              />
            </Field>
            <Button
              appearance="primary"
              onClick={handleCreateAllocation}
              disabled={!canEdit || !effectiveNewAllocationPositionId}
            >
              Add allocation
            </Button>
          </div>
        )}
      </div>

      <div className="app-surface">
        <h3>Reduce allocations</h3>
        {allocationsForGoal.length === 0 ? (
          <div className="app-muted">No allocations to reduce.</div>
        ) : (
          <div className="section-stack">
            {allocationsForGoal.map((allocation) => {
              const position = positionsById.get(allocation.positionId);
              return (
                <Field
                  key={allocation.id}
                  label={`Reduce ${position?.label ?? "Allocation"} (current ${formatCurrency(
                    allocation.allocatedAmount,
                  )})`}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={mergedReductions[allocation.id] ?? "0"}
                    onChange={(_, data) =>
                      setAllocationReductions((prev) => ({
                        ...prev,
                        [allocation.id]: data.value,
                      }))
                    }
                    disabled={!canEdit}
                  />
                </Field>
              );
            })}
            <Button appearance="primary" onClick={handleReduceAllocations} disabled={!canEdit}>
              Apply reductions
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export function GoalsView({ data }: { data: DataContextValue }) {
  const {
    draftState,
    isOnline,
    isSignedIn,
    canWrite,
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

  const effectiveGoalId = useMemo(() => {
    if (selectedGoalId && goalsSorted.some((goal) => goal.id === selectedGoalId)) {
      return selectedGoalId;
    }
    return goalsSorted[0]?.id ?? null;
  }, [goalsSorted, selectedGoalId]);

  const selectedGoal = goals.find((goal) => goal.id === effectiveGoalId) ?? null;
  const selectedGoalSpent = Boolean(selectedGoal?.spentAt);
  const canEditSelectedGoal = canEdit && !selectedGoalSpent;
  const reducedClosedOrSpent = useMemo(() => {
    if (!allocationNotice) {
      return false;
    }
    return allocationNotice.changes.some((change) => {
      if (change.after >= change.before) {
        return false;
      }
      const goal = goalsById.get(change.goalId);
      return goal ? goal.status === "closed" || Boolean(goal.spentAt) : false;
    });
  }, [allocationNotice, goalsById]);

  const [allocationEditMode, setAllocationEditMode] = useState<"summary" | "direct" | null>(null);
  const [allocationEditReason, setAllocationEditReason] = useState<string | null>(null);

  useEffect(() => {
    if (!allocationNotice) {
      return;
    }
    if (allocationNotice.requiresDirectEdit) {
      const timerId = window.setTimeout(() => {
        setAllocationEditMode("direct");
        setAllocationEditReason(
          allocationNotice.directReasons.length > 0
            ? `${allocationNotice.directReasons.join(" ")} Review the proposed allocations below.`
            : "Manual allocation review is required. Review the proposed allocations below.",
        );
        if (allocationNotice.affectedGoalIds.length > 0) {
          setSelectedGoalId(allocationNotice.affectedGoalIds[0]);
        }
      }, 0);
      return () => {
        window.clearTimeout(timerId);
      };
    }
    return;
  }, [allocationNotice]);

  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const reportOutcome = (result: { ok: boolean; error?: string }, message: string) => {
    if (!result.ok) {
      setPageError(result.error ?? "Something went wrong.");
      setPageMessage(null);
      return false;
    }
    setPageError(null);
    setPageMessage(message);
    return true;
  };

  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTargetAmount, setNewGoalTargetAmount] = useState("0");
  const [newGoalPriority, setNewGoalPriority] = useState("0");
  const [newGoalStatus, setNewGoalStatus] = useState<"active" | "closed">("active");
  const [newGoalStartDate, setNewGoalStartDate] = useState("");
  const [newGoalEndDate, setNewGoalEndDate] = useState("");

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

  const spendDefaults = useMemo(
    () => buildSpendDefaults(selectedGoalAllocations),
    [selectedGoalAllocations],
  );
  const [spendInputs, setSpendInputs] = useState<Record<string, string>>({});
  const mergedSpendInputs = useMemo(
    () => ({ ...spendDefaults, ...spendInputs }),
    [spendDefaults, spendInputs],
  );
  const selectedGoalTotalAllocated = useMemo(
    () => selectedGoalAllocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0),
    [selectedGoalAllocations],
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setSpendInputs({});
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [selectedGoal?.id]);

  const handleCreateGoal = () => {
    const targetAmount = parseIntegerInput(newGoalTargetAmount);
    const priority = parseIntegerInput(newGoalPriority);
    if (targetAmount === null) {
      setPageError("Target amount must be a non-negative integer.");
      return;
    }
    if (priority === null) {
      setPageError("Priority must be a non-negative integer.");
      return;
    }
    const result = createGoal({
      name: newGoalName,
      targetAmount,
      priority,
      status: newGoalStatus,
      startDate: newGoalStartDate,
      endDate: newGoalEndDate,
    });
    if (reportOutcome(result, "Goal created in draft.")) {
      setNewGoalName("");
      setNewGoalTargetAmount("0");
      setNewGoalPriority("0");
      setNewGoalStatus("active");
      setNewGoalStartDate("");
      setNewGoalEndDate("");
    }
  };

  const handleUpdateGoal = (input: {
    name: string;
    targetAmount: string;
    priority: string;
    status: "active" | "closed";
    startDate: string;
    endDate: string;
  }) => {
    if (!selectedGoal) {
      setPageError("Select a goal to edit.");
      return;
    }
    const targetAmount = parseIntegerInput(input.targetAmount);
    const priority = parseIntegerInput(input.priority);
    if (targetAmount === null) {
      setPageError("Target amount must be a non-negative integer.");
      return;
    }
    if (priority === null) {
      setPageError("Priority must be a non-negative integer.");
      return;
    }
    reportOutcome(
      updateGoal({
        goalId: selectedGoal.id,
        name: input.name,
        targetAmount,
        priority,
        status: input.status,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
      "Goal updated in draft.",
    );
  };

  const handleDeleteGoal = () => {
    if (!selectedGoal) {
      setPageError("Select a goal to delete.");
      return;
    }
    reportOutcome(deleteGoal(selectedGoal.id), "Goal deleted in draft.");
  };

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

  const handleSpendGoal = () => {
    if (!selectedGoal) {
      setPageError("Select a goal to spend.");
      return;
    }
    const payments = selectedGoalAllocations.map((allocation) => {
      const raw = mergedSpendInputs[allocation.id] ?? "0";
      const amount = parseIntegerInput(raw);
      return {
        allocation,
        amount: amount ?? -1,
      };
    });
    if (payments.some((item) => item.amount < 0)) {
      setPageError("Payment amounts must be non-negative integers.");
      return;
    }
    const paymentTotal = payments.reduce((sum, item) => sum + item.amount, 0);
    if (paymentTotal !== selectedGoalTotalAllocated) {
      setPageError("Payments must total the goal allocation amount.");
      return;
    }
    const exceedsAllocation = payments.some(
      (item) => item.amount > item.allocation.allocatedAmount,
    );
    if (exceedsAllocation) {
      setPageError("Payment amounts cannot exceed allocated amounts.");
      return;
    }
    const result = spendGoal({
      goalId: selectedGoal.id,
      payments: payments.map((item) => ({
        positionId: item.allocation.positionId,
        amount: item.amount,
      })),
    });
    if (reportOutcome(result, "Goal marked as spent in draft.")) {
      setSpendInputs({});
    }
  };

  const handleUndoSpend = () => {
    if (!selectedGoal) {
      setPageError("Select a goal to undo.");
      return;
    }
    reportOutcome(undoSpend(selectedGoal.id), "Spend undone in draft.");
  };

  const handleOpenAllocationEdit = (mode: "summary" | "direct") => {
    setAllocationEditMode(mode);
    setAllocationEditReason(
      mode === "direct"
        ? `${allocationNotice?.directReasons?.join(" ") || "Manual allocation review is required."} Review the proposed allocations below.`
        : "Review the adjustments below, then edit allocations if needed.",
    );
    if (allocationNotice && allocationNotice.affectedGoalIds.length > 0) {
      setSelectedGoalId(allocationNotice.affectedGoalIds[0]);
    }
  };

  const handleDismissAllocationNotice = () => {
    clearAllocationNotice();
    setAllocationEditMode(null);
    setAllocationEditReason(null);
  };

  return (
    <div className="section-stack">
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
      {pageMessage ? (
        <div className="app-alert" role="status">
          <Text>{pageMessage}</Text>
        </div>
      ) : null}
      {pageError ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>{pageError}</Text>
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
            {allocationNotice.requiresDirectEdit ? (
              <Text>
                Suggested reductions follow priority order: lower-priority active goals first, then
                closed or spent goals by most recent close time.
              </Text>
            ) : null}
            {reducedClosedOrSpent ? (
              <Text>
                Reductions to closed or spent goals will not be restored automatically. Add them
                back manually if needed.
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
                onClick={() =>
                  handleOpenAllocationEdit(
                    allocationNotice.requiresDirectEdit ? "direct" : "summary",
                  )
                }
              >
                Edit allocations
              </Button>
              <Button onClick={handleDismissAllocationNotice}>Dismiss</Button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="app-surface">
        <h2>Goal list</h2>
        {goalsSorted.length === 0 ? (
          <div className="app-muted">No goals yet. Create one to get started.</div>
        ) : (
          <div className="card-grid">
            {goalsSorted.map((goal) => {
              const allocated = allocationTotalsByGoal[goal.id] ?? 0;
              return (
                <div key={goal.id} className="app-surface">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{goal.name}</div>
                      <div className="app-muted">Priority {goal.priority}</div>
                    </div>
                    <Button
                      size="small"
                      onClick={() => setSelectedGoalId(goal.id)}
                      appearance={effectiveGoalId === goal.id ? "primary" : "secondary"}
                    >
                      View
                    </Button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600 }}>
                      {formatCurrency(allocated)} of {formatCurrency(goal.targetAmount)}
                    </div>
                    <div className="app-muted">Status: {goal.spentAt ? "Spent" : goal.status}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="app-surface">
        <h2>Create goal</h2>
        <div className="section-stack">
          <Field label="Goal name">
            <Input
              value={newGoalName}
              onChange={(_, data) => setNewGoalName(data.value)}
              placeholder="Emergency fund"
              disabled={!canEdit}
            />
          </Field>
          <Field label="Target amount (JPY)">
            <Input
              type="number"
              inputMode="numeric"
              value={newGoalTargetAmount}
              onChange={(_, data) => setNewGoalTargetAmount(data.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Priority">
            <Input
              type="number"
              inputMode="numeric"
              value={newGoalPriority}
              onChange={(_, data) => setNewGoalPriority(data.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Status">
            <Dropdown
              selectedOptions={[newGoalStatus]}
              onOptionSelect={(_, data) => {
                const value = data.optionValue as "active" | "closed" | undefined;
                if (value) {
                  setNewGoalStatus(value);
                }
              }}
              disabled={!canEdit}
            >
              <Option value="active">Active</Option>
              <Option value="closed">Closed</Option>
            </Dropdown>
          </Field>
          <Field label="Start date (optional)">
            <Input
              type="date"
              value={newGoalStartDate}
              onChange={(_, data) => setNewGoalStartDate(data.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="End date (optional)">
            <Input
              type="date"
              value={newGoalEndDate}
              onChange={(_, data) => setNewGoalEndDate(data.value)}
              disabled={!canEdit}
            />
          </Field>
          <Button appearance="primary" onClick={handleCreateGoal} disabled={!canEdit}>
            Add goal
          </Button>
        </div>
      </section>

      <section className="app-surface">
        <h2>Goal details</h2>
        {!selectedGoal ? (
          <div className="app-muted">Select a goal to view details.</div>
        ) : (
          <div className="section-stack">
            <GoalDetailsPanel
              key={selectedGoal.id}
              goal={selectedGoal}
              canEdit={canEditSelectedGoal}
              onUpdate={handleUpdateGoal}
              onDelete={handleDeleteGoal}
            />
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
                      onClick={handleUndoSpend}
                      disabled={!canEdit || !undoInfo.available}
                    >
                      Undo spend
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="app-surface">
        <h2>Allocations</h2>
        {!selectedGoal ? (
          <div className="app-muted">Select a goal to manage allocations.</div>
        ) : (
          <div className="section-stack">
            {allocationEditMode ? (
              <div className="app-alert" role="status">
                <Text>{allocationEditReason}</Text>
              </div>
            ) : null}
            <GoalAllocationsPanel
              goal={selectedGoal}
              positions={positions}
              allocations={selectedGoalAllocations}
              positionsById={positionsById}
              accountsById={accountsById}
              allocationTotalsByPosition={allocationTotalsByPosition}
              canEdit={canEditSelectedGoal}
              reportOutcome={reportOutcome}
              setPageError={setPageError}
              createAllocation={createAllocation}
              updateAllocation={updateAllocation}
              deleteAllocation={deleteAllocation}
              reduceAllocations={reduceAllocations}
            />
          </div>
        )}
      </section>

      <section className="app-surface">
        <h2>Spend goal</h2>
        {!selectedGoal ? (
          <div className="app-muted">Select a goal to mark it as spent.</div>
        ) : selectedGoal.spentAt ? (
          <div className="app-muted">This goal is already marked as spent.</div>
        ) : selectedGoal.status !== "closed" ? (
          <div className="app-muted">Close the goal before marking it as spent.</div>
        ) : selectedGoalAllocations.length === 0 ? (
          <div className="app-muted">No allocations are available to spend.</div>
        ) : (
          <div className="section-stack">
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
                    type="number"
                    inputMode="numeric"
                    value={mergedSpendInputs[allocation.id] ?? "0"}
                    onChange={(_, data) =>
                      setSpendInputs((prev) => ({
                        ...prev,
                        [allocation.id]: data.value,
                      }))
                    }
                    disabled={!canEditSelectedGoal}
                  />
                </Field>
              );
            })}
            <Button appearance="primary" onClick={handleSpendGoal} disabled={!canEditSelectedGoal}>
              Mark as spent
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
