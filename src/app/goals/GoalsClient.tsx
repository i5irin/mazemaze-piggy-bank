"use client";

import { Button, Dropdown, Field, Input, Option, Text } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import { usePersonalData } from "@/components/PersonalDataProvider";
import type { Account, Allocation, Goal, Position } from "@/lib/persistence/types";

const formatCurrency = (value: number): string => `¥${value.toLocaleString("en-US")}`;

const parseNonNegativeInteger = (value: string): number | null => {
  if (value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

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
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [allocations, goal.id]);

  const availablePositionsForGoal = useMemo(() => {
    return positions.filter((position) => {
      return !allocations.some(
        (allocation) => allocation.goalId === goal.id && allocation.positionId === position.id,
      );
    });
  }, [allocations, goal.id, positions]);

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
    const amount = parseNonNegativeInteger(newAllocationAmount);
    if (amount === null) {
      setPageError("Allocated amount must be a non-negative integer.");
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
    const amount = parseNonNegativeInteger(value);
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
      const amount = parseNonNegativeInteger(raw);
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

export default function GoalsClient() {
  const {
    draftState,
    isOnline,
    isSignedIn,
    createGoal,
    updateGoal,
    deleteGoal,
    createAllocation,
    updateAllocation,
    deleteAllocation,
    reduceAllocations,
  } = usePersonalData();

  const canEdit = isOnline && isSignedIn;
  const goals = useMemo(() => draftState?.goals ?? [], [draftState?.goals]);
  const positions = useMemo(() => draftState?.positions ?? [], [draftState?.positions]);
  const accounts = useMemo(() => draftState?.accounts ?? [], [draftState?.accounts]);
  const allocations = useMemo(() => draftState?.allocations ?? [], [draftState?.allocations]);

  const goalsSorted = useMemo(
    () =>
      [...goals].sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }
        return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
      }),
    [goals],
  );

  const positionsById = useMemo(
    () => new Map(positions.map((position) => [position.id, position])),
    [positions],
  );

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

  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);

  const effectiveGoalId = useMemo(() => {
    if (selectedGoalId && goalsSorted.some((goal) => goal.id === selectedGoalId)) {
      return selectedGoalId;
    }
    return goalsSorted[0]?.id ?? null;
  }, [goalsSorted, selectedGoalId]);

  const selectedGoal = goals.find((goal) => goal.id === effectiveGoalId) ?? null;

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
  const [newGoalPriority, setNewGoalPriority] = useState("1");
  const [newGoalStatus, setNewGoalStatus] = useState<"active" | "closed">("active");
  const [newGoalStartDate, setNewGoalStartDate] = useState("");
  const [newGoalEndDate, setNewGoalEndDate] = useState("");

  const handleCreateGoal = () => {
    const targetAmount = parseNonNegativeInteger(newGoalTargetAmount);
    const priority = parseNonNegativeInteger(newGoalPriority);
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
      setNewGoalPriority("1");
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
    const targetAmount = parseNonNegativeInteger(input.targetAmount);
    const priority = parseNonNegativeInteger(input.priority);
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

  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Goals</h1>
        <p className="app-muted">Manage savings goals and allocations.</p>
      </section>

      {!canEdit ? (
        <div className="app-alert" role="status">
          <Text>
            {isOnline
              ? "Sign in to edit. Offline mode is view-only."
              : "Offline mode is view-only. Connect to the internet to edit."}
          </Text>
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
                    <div className="app-muted">Status: {goal.status}</div>
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
          <GoalDetailsPanel
            key={selectedGoal.id}
            goal={selectedGoal}
            canEdit={canEdit}
            onUpdate={handleUpdateGoal}
            onDelete={handleDeleteGoal}
          />
        )}
      </section>

      <section className="app-surface">
        <h2>Allocations</h2>
        {!selectedGoal ? (
          <div className="app-muted">Select a goal to manage allocations.</div>
        ) : (
          <GoalAllocationsPanel
            key={selectedGoal.id}
            goal={selectedGoal}
            positions={positions}
            allocations={allocations}
            positionsById={positionsById}
            accountsById={accountsById}
            allocationTotalsByPosition={allocationTotalsByPosition}
            canEdit={canEdit}
            reportOutcome={reportOutcome}
            setPageError={setPageError}
            createAllocation={createAllocation}
            updateAllocation={updateAllocation}
            deleteAllocation={deleteAllocation}
            reduceAllocations={reduceAllocations}
          />
        )}
      </section>
    </div>
  );
}
