"use client";

import { Button, Spinner, Text } from "@fluentui/react-components";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { DataContextValue } from "@/components/dataContext";
import {
  buildAccountSummary,
  buildAlertSummary,
  buildAssetSummary,
  buildDashboardTotals,
  buildGoalProgress,
  buildRecentChange,
  buildRecentPositions,
  formatCurrency,
  formatPercent,
  formatTimestamp,
  getProgressRatio,
} from "@/components/dashboard/dashboardData";
import { getDeviceId } from "@/lib/lease/deviceId";
import { useNow } from "@/lib/time/useNow";

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

export function DashboardView({ data }: { data: DataContextValue }) {
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
    saveChanges,
    discardChanges,
    canWrite,
    space,
    lease,
    leaseError,
    allocationNotice,
    latestEvent,
  } = data;

  const totals = useMemo(() => buildDashboardTotals(draftState), [draftState]);
  const progressRatio = useMemo(() => getProgressRatio(totals), [totals]);
  const goals = useMemo(() => buildGoalProgress(draftState), [draftState]);
  const accounts = useMemo(() => draftState?.accounts ?? [], [draftState?.accounts]);
  const positions = useMemo(() => draftState?.positions ?? [], [draftState?.positions]);
  const allocations = useMemo(() => draftState?.allocations ?? [], [draftState?.allocations]);
  const accountSummary = useMemo(
    () => buildAccountSummary(accounts, positions, allocations),
    [accounts, positions, allocations],
  );
  const assetSummary = useMemo(() => buildAssetSummary(positions), [positions]);
  const recentPositions = useMemo(() => buildRecentPositions(positions), [positions]);
  const recentChange = useMemo(() => buildRecentChange(latestEvent), [latestEvent]);
  const alertSummary = useMemo(() => buildAlertSummary(allocationNotice), [allocationNotice]);

  const summaryCards = [
    { label: "Total assets", value: formatCurrency(totals.totalAssets) },
    { label: "Allocated", value: formatCurrency(totals.allocated) },
    { label: "Unallocated", value: formatCurrency(totals.unallocated) },
  ];

  const sourceLabel = source === "remote" ? "OneDrive" : source === "cache" ? "Cache" : "Empty";
  const canEdit = isOnline && isSignedIn && canWrite;
  const isBusy = activity !== "idle";
  const updatedAt = snapshot?.updatedAt ?? null;
  const editNotice = getEditNotice(data);
  const [assetTab, setAssetTab] = useState<"account" | "asset">("account");
  const deviceId = useMemo(() => getDeviceId(), []);
  const isLocalLease = Boolean(lease?.deviceId && deviceId && lease.deviceId === deviceId);
  const now = useNow(1000);
  const [historyTab, setHistoryTab] = useState<"goals" | "positions">("goals");
  const isActiveLease = (() => {
    if (!lease?.leaseUntil) {
      return false;
    }
    const expiresAt = Date.parse(lease.leaseUntil);
    if (Number.isNaN(expiresAt)) {
      return false;
    }
    return expiresAt > now;
  })();
  const showLeaseBanner = Boolean(lease?.holderLabel && isActiveLease && !isLocalLease);
  const scopeLabel = space.scope === "shared" ? "Shared" : "Personal";
  const goalHistoryHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("tab", "history");
    if (goals[0]?.id) {
      params.set("goalId", goals[0].id);
    }
    return `/goals?${params.toString()}`;
  }, [goals]);
  const positionHistoryHref = useMemo(() => {
    const target = recentPositions[0];
    if (!target) {
      return "/accounts";
    }
    const params = new URLSearchParams();
    params.set("accountId", target.accountId);
    params.set("drawer", "position");
    params.set("positionId", target.id);
    params.set("positionTab", "history");
    return `/accounts?${params.toString()}`;
  }, [recentPositions]);

  return (
    <div className="section-stack dashboard-root">
      {showLeaseBanner ? (
        <div className="dashboard-lease-banner" role="status">
          <span>Editing in progress: {lease?.holderLabel ?? "Unknown"}.</span>
        </div>
      ) : null}

      <section className="app-surface dashboard-hero">
        <div className="dashboard-hero-header">
          <div>
            <h1>Dashboard</h1>
            <p className="app-muted">Warm precision at a glance.</p>
          </div>
          <div className="dashboard-hero-meta">
            {space.scope === "shared" ? (
              <div className="dashboard-shared-meta">
                <Link href="/shared" className="dashboard-link">
                  Back to Shared
                </Link>
                <div className="dashboard-scope-pill">{scopeLabel}</div>
                <div className="dashboard-shared-label">{space.label}</div>
                <div className="app-muted">Shared ID: {space.sharedId ?? "Unknown"}</div>
              </div>
            ) : (
              <div className="dashboard-scope-pill">{scopeLabel}</div>
            )}
          </div>
        </div>

        <div className="dashboard-progress">
          <div className="dashboard-progress-header">
            <div className="dashboard-progress-title">Global progress</div>
            <div className="dashboard-progress-value">{formatPercent(progressRatio)}</div>
          </div>
          <div className="dashboard-progress-bar" aria-hidden>
            <div
              className="dashboard-progress-fill"
              style={{ width: `${Math.min(100, (progressRatio ?? 0) * 100)}%` }}
            />
          </div>
          <div className="dashboard-progress-meta">
            <span>{formatCurrency(totals.activeAllocatedTotal)}</span>
            <span className="app-muted">of {formatCurrency(totals.activeTargetTotal)}</span>
          </div>
        </div>

        <div className="dashboard-summary-grid">
          {summaryCards.map((item) => (
            <div key={item.label} className="dashboard-summary-card">
              <div className="app-muted">{item.label}</div>
              <div className="dashboard-summary-value">{item.value}</div>
            </div>
          ))}
          <div className="dashboard-free-chip">
            Total Free: {formatCurrency(totals.unallocated)}
          </div>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>Goals</h2>
              <Link href="/goals" className="dashboard-link">
                Open goals
              </Link>
            </div>
            {goals.length === 0 ? (
              <div className="app-muted">No active goals yet.</div>
            ) : (
              <div className="dashboard-goal-grid">
                {goals.map((goal) => (
                  <div key={goal.id} className="dashboard-goal-card">
                    <div className="dashboard-goal-header">
                      <div className="dashboard-goal-title">{goal.name}</div>
                      <div className="dashboard-goal-percent">
                        {formatPercent(goal.progressRatio)}
                      </div>
                    </div>
                    <div className="dashboard-goal-values">
                      <span>{formatCurrency(goal.allocatedAmount)}</span>
                      <span className="app-muted">of {formatCurrency(goal.targetAmount)}</span>
                    </div>
                    <div className="dashboard-progress-bar" aria-hidden>
                      <div
                        className="dashboard-progress-fill"
                        style={{ width: `${Math.min(100, goal.progressRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>Frequently used positions</h2>
              <Link href="/accounts" className="dashboard-link">
                Open accounts
              </Link>
            </div>
            {recentPositions.length === 0 ? (
              <div className="app-muted">No positions yet.</div>
            ) : (
              <div className="dashboard-list">
                {recentPositions.map((position) => (
                  <div key={position.id} className="dashboard-list-item">
                    <div>
                      <div className="dashboard-list-title">{position.label}</div>
                      <div className="app-muted">
                        Updated: {formatTimestamp(position.updatedAt)}
                      </div>
                    </div>
                    <div className="dashboard-list-value">
                      {formatCurrency(position.marketValue)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="dashboard-side">
          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>Assets overview</h2>
              <div className="dashboard-tabs" role="tablist" aria-label="Assets overview">
                <button
                  type="button"
                  className={`dashboard-tab ${assetTab === "account" ? "is-active" : ""}`}
                  onClick={() => setAssetTab("account")}
                  role="tab"
                  aria-selected={assetTab === "account"}
                >
                  By account
                </button>
                <button
                  type="button"
                  className={`dashboard-tab ${assetTab === "asset" ? "is-active" : ""}`}
                  onClick={() => setAssetTab("asset")}
                  role="tab"
                  aria-selected={assetTab === "asset"}
                >
                  By asset
                </button>
              </div>
            </div>

            {assetTab === "account" ? (
              accountSummary.length === 0 ? (
                <div className="app-muted">No accounts yet.</div>
              ) : (
                <div className="dashboard-list">
                  {accountSummary.map((account) => (
                    <Link
                      key={account.id}
                      href="/accounts"
                      className="dashboard-list-item dashboard-list-link"
                    >
                      <div>
                        <div className="dashboard-list-title">{account.name}</div>
                        <div className="app-muted">{account.positionCount} positions</div>
                      </div>
                      <div className="dashboard-list-value">
                        <div>{formatCurrency(account.total)}</div>
                        <div className="app-muted">Free {formatCurrency(account.free)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )
            ) : assetSummary.length === 0 ? (
              <div className="app-muted">No assets yet.</div>
            ) : (
              <div className="dashboard-asset-list">
                {assetSummary.map((asset) => (
                  <div key={asset.assetType} className="dashboard-asset-item">
                    <div className="dashboard-asset-header">
                      <span>{asset.label}</span>
                      <span>{formatCurrency(asset.total)}</span>
                    </div>
                    <div className="dashboard-asset-bar" aria-hidden>
                      <div
                        className="dashboard-asset-fill"
                        style={{ width: `${Math.min(100, asset.ratio * 100)}%` }}
                      />
                    </div>
                    <div className="app-muted">{formatPercent(asset.ratio)} of total</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>Recent changes</h2>
            </div>
            {recentChange ? (
              <div className="dashboard-list">
                <div className="dashboard-list-item">
                  <div>
                    <div className="dashboard-list-title">{recentChange.title}</div>
                    <div className="app-muted">{recentChange.detail}</div>
                  </div>
                  <div className="dashboard-list-value">
                    {formatTimestamp(recentChange.timestamp)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="app-muted">No recent changes yet.</div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>History</h2>
            </div>
            <div className="dashboard-tabs" role="tablist" aria-label="History shortcuts">
              <button
                type="button"
                className={`dashboard-tab ${historyTab === "goals" ? "is-active" : ""}`}
                onClick={() => setHistoryTab("goals")}
                role="tab"
                aria-selected={historyTab === "goals"}
              >
                Goals
              </button>
              <button
                type="button"
                className={`dashboard-tab ${historyTab === "positions" ? "is-active" : ""}`}
                onClick={() => setHistoryTab("positions")}
                role="tab"
                aria-selected={historyTab === "positions"}
              >
                Positions
              </button>
            </div>
            {historyTab === "goals" ? (
              <div className="section-stack">
                <div className="app-muted">
                  {goals.length === 0
                    ? "No goals available yet."
                    : "Open the Goals history tab to review recent changes."}
                </div>
                <Link href={goalHistoryHref} className="dashboard-link">
                  Open goal history
                </Link>
              </div>
            ) : (
              <div className="section-stack">
                <div className="app-muted">
                  {recentPositions.length === 0
                    ? "No positions available yet."
                    : "Open position history from the selected position drawer."}
                </div>
                <Link href={positionHistoryHref} className="dashboard-link">
                  Open position history
                </Link>
              </div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>Alerts</h2>
              <Link href="/goals" className="dashboard-link">
                Review allocations
              </Link>
            </div>
            {alertSummary ? (
              <div className="app-alert" role="status">
                <Text>{alertSummary}</Text>
                {allocationNotice?.requiresDirectEdit ? (
                  <div className="app-muted" style={{ marginTop: 8 }}>
                    Direct review is recommended.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="app-muted">No alerts right now.</div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <h2>Sync status</h2>
              <Link href="/settings#sync-status" className="dashboard-link">
                Open settings
              </Link>
            </div>
            <div className="dashboard-status-grid">
              <div className="app-muted">Status</div>
              <div>{status === "loading" ? "Loading" : status}</div>
              <div className="app-muted">Source</div>
              <div>{sourceLabel}</div>
              <div className="app-muted">Version</div>
              <div>{snapshot?.version ?? "—"}</div>
              <div className="app-muted">Updated</div>
              <div>{formatTimestamp(updatedAt)}</div>
              <div className="app-muted">Online</div>
              <div>{isOnline ? "Yes" : "No"}</div>
              <div className="app-muted">Signed in</div>
              <div>{isSignedIn ? "Yes" : "No"}</div>
              <div className="app-muted">Unsaved changes</div>
              <div>{isDirty ? "Yes" : "No"}</div>
            </div>
            <div className="app-actions" style={{ marginTop: 12 }}>
              <Button onClick={refresh} disabled={isBusy}>
                {isOnline && isSignedIn ? "Refresh from OneDrive" : "Load cached data"}
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
            {editNotice ? (
              <div className="app-alert" role="status">
                <Text>{editNotice}</Text>
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

          {leaseError ? (
            <section className="app-surface dashboard-section">
              <h2>Lease status</h2>
              <div className="app-alert" role="status">
                <Text>{leaseError}</Text>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <Link href="/accounts" className="dashboard-fab" aria-label="Add account or position">
        +
      </Link>
    </div>
  );
}
