"use client";

import { Button, Spinner, Text } from "@fluentui/react-components";
import { useMemo } from "react";
import { usePersonalData } from "@/components/PersonalDataProvider";
import type { Allocation, Goal, NormalizedState } from "@/lib/persistence/types";

const formatCurrency = (value: number | null): string => {
  if (value === null) {
    return "—";
  }
  return `¥${value.toLocaleString("en-US")}`;
};

const sumBy = <T,>(items: T[], pick: (item: T) => number): number =>
  items.reduce((total, item) => total + pick(item), 0);

const getTotals = (state: NormalizedState | null) => {
  if (!state) {
    return { totalAssets: null, allocated: null, unallocated: null };
  }
  const totalAssets = sumBy(state.positions, (position) => position.marketValue);
  const allocated = sumBy(state.allocations, (allocation) => allocation.allocatedAmount);
  const unallocated = Math.max(0, totalAssets - allocated);
  return { totalAssets, allocated, unallocated };
};

const buildGoalHighlights = (
  goals: Goal[],
  allocations: Allocation[],
): { title: string; detail: string }[] => {
  if (goals.length === 0) {
    return [];
  }
  const allocationByGoal = allocations.reduce<Record<string, number>>((acc, allocation) => {
    acc[allocation.goalId] = (acc[allocation.goalId] ?? 0) + allocation.allocatedAmount;
    return acc;
  }, {});
  const goalsSorted = [...goals].sort((a, b) => a.priority - b.priority);
  return goalsSorted.slice(0, 3).map((goal) => {
    const allocated = allocationByGoal[goal.id] ?? 0;
    const progress = `${formatCurrency(allocated)} of ${formatCurrency(goal.targetAmount)}`;
    return {
      title: goal.name,
      detail: progress,
    };
  });
};

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export default function DashboardClient() {
  const {
    status,
    activity,
    source,
    snapshot,
    draftState,
    isOnline,
    isSignedIn,
    isDirty,
    message,
    error,
    refresh,
    applyDemoChange,
    saveChanges,
    discardChanges,
  } = usePersonalData();

  const totals = useMemo(() => getTotals(draftState), [draftState]);
  const highlights = useMemo(
    () => (draftState ? buildGoalHighlights(draftState.goals, draftState.allocations) : []),
    [draftState],
  );

  const summaryCards = [
    { label: "Total assets", value: formatCurrency(totals.totalAssets) },
    { label: "Allocated", value: formatCurrency(totals.allocated) },
    { label: "Unallocated", value: formatCurrency(totals.unallocated) },
  ];

  const sourceLabel = source === "remote" ? "OneDrive" : source === "cache" ? "Cache" : "Empty";
  const canEdit = isOnline && isSignedIn;
  const isBusy = activity !== "idle";
  const updatedAt = snapshot?.updatedAt ?? null;

  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Dashboard</h1>
        <p className="app-muted">Overview of your latest snapshot and goal progress.</p>
      </section>

      <section className="card-grid">
        {summaryCards.map((item) => (
          <div key={item.label} className="app-surface">
            <div className="app-muted">{item.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 600 }}>{item.value}</div>
          </div>
        ))}
      </section>

      <section className="app-surface">
        <h2>Snapshot status</h2>
        <div className="section-stack">
          <div className="app-muted">Status: {status === "loading" ? "Loading" : status}</div>
          <div>Source: {sourceLabel}</div>
          <div>Version: {snapshot?.version ?? "—"}</div>
          <div>Updated: {formatTimestamp(updatedAt)}</div>
          <div>Online: {isOnline ? "Yes" : "No"}</div>
          <div>Signed in: {isSignedIn ? "Yes" : "No"}</div>
          <div>Unsaved changes: {isDirty ? "Yes" : "No"}</div>
        </div>
        <div className="app-actions" style={{ marginTop: 12 }}>
          <Button onClick={refresh} disabled={isBusy}>
            {isOnline && isSignedIn ? "Refresh from OneDrive" : "Load cached data"}
          </Button>
          <Button onClick={applyDemoChange} disabled={!canEdit || isBusy}>
            Apply demo change
          </Button>
          <Button
            appearance="primary"
            onClick={saveChanges}
            disabled={!canEdit || !isDirty || isBusy}
          >
            Save changes
          </Button>
          <Button onClick={discardChanges} disabled={!isDirty || isBusy}>
            Discard changes
          </Button>
          {isBusy ? <Spinner size="tiny" /> : null}
        </div>
        {!canEdit ? (
          <div className="app-alert" role="status">
            <Text>
              {isOnline
                ? "Sign in to edit. Offline mode is view-only."
                : "Offline mode is view-only. Connect to the internet to edit."}
            </Text>
          </div>
        ) : null}
        {message ? (
          <div className="app-alert" role="status">
            <Text>{message}</Text>
          </div>
        ) : null}
        {error ? (
          <div className="app-alert app-alert-error" role="alert">
            <Text>{error}</Text>
          </div>
        ) : null}
      </section>

      <section className="app-surface">
        <h2>Highlights</h2>
        {highlights.length === 0 ? (
          <div className="app-muted">No goals yet.</div>
        ) : (
          <div className="section-stack">
            {highlights.map((item) => (
              <div key={item.title}>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                <div className="app-muted">{item.detail}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
