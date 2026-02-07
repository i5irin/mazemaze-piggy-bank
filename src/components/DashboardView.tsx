"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataContextValue } from "@/components/dataContext";
import {
  buildAccountSummary,
  buildAssetSummary,
  buildDashboardTotals,
  buildGoalProgress,
  buildRecentPositions,
  formatCurrency,
  formatPercent,
  getProgressRatio,
} from "@/components/dashboard/dashboardData";
import type { HistoryItem } from "@/lib/persistence/history";
import { getDeviceId } from "@/lib/lease/deviceId";
import { useNow } from "@/lib/time/useNow";

const ACTIVITY_LIMIT = 5;
const GOAL_LIMIT = 5;
const ACCOUNT_LIMIT = 5;
const QUICK_UPDATE_LIMIT = 5;

const formatRelativeTimestamp = (value: string, now: number): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }
  const diffMs = parsed.getTime() - now;
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMinutes < 60) {
    return formatter.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return formatter.format(diffDays, "day");
  }
  return parsed.toLocaleDateString("en-US");
};

const toHistoryOriginLabel = (origin: HistoryItem["origin"]): string =>
  origin === "system" ? "System" : "User";

const formatDelta = (amount: number): string => {
  if (amount === 0) {
    return formatCurrency(amount);
  }
  const sign = amount > 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(amount))}`;
};

export function DashboardView({ data }: { data: DataContextValue }) {
  const {
    draftState,
    isOnline,
    isSignedIn,
    space,
    lease,
    leaseError,
    latestEvent,
    loadHistoryPage,
  } = data;

  const totals = useMemo(() => buildDashboardTotals(draftState), [draftState]);
  const progressRatio = useMemo(() => getProgressRatio(totals), [totals]);
  const goals = useMemo(() => buildGoalProgress(draftState), [draftState]);
  const goalCards = useMemo(() => goals.slice(0, GOAL_LIMIT), [goals]);
  const accounts = useMemo(() => draftState?.accounts ?? [], [draftState?.accounts]);
  const positions = useMemo(() => draftState?.positions ?? [], [draftState?.positions]);
  const allocations = useMemo(() => draftState?.allocations ?? [], [draftState?.allocations]);
  const accountSummary = useMemo(
    () => buildAccountSummary(accounts, positions, allocations),
    [accounts, positions, allocations],
  );
  const accountSummaryTop = useMemo(() => {
    const sorted = [...accountSummary].sort((left, right) => {
      if (left.total !== right.total) {
        return right.total - left.total;
      }
      const nameCompare = left.name.localeCompare(right.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return left.id.localeCompare(right.id);
    });
    return sorted.slice(0, ACCOUNT_LIMIT);
  }, [accountSummary]);
  const assetSummary = useMemo(() => buildAssetSummary(positions), [positions]);
  const recentPositions = useMemo(
    () => buildRecentPositions(positions, QUICK_UPDATE_LIMIT),
    [positions],
  );
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const summaryCards = [
    { label: "Total assets", value: formatCurrency(totals.totalAssets) },
    { label: "Allocated", value: formatCurrency(totals.allocated) },
    { label: "Unallocated", value: formatCurrency(totals.unallocated) },
  ];

  const [assetTab, setAssetTab] = useState<"account" | "asset">("account");
  const [activityItems, setActivityItems] = useState<HistoryItem[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const activityRequestRef = useRef(0);

  const deviceId = useMemo(() => getDeviceId(), []);
  const isLocalLease = Boolean(lease?.deviceId && deviceId && lease.deviceId === deviceId);
  const now = useNow(1000);
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

  const accountsBasePath =
    space.scope === "shared" && space.sharedId
      ? `/shared/${encodeURIComponent(space.sharedId)}/accounts`
      : "/accounts";
  const goalsBasePath =
    space.scope === "shared" && space.sharedId
      ? `/shared/${encodeURIComponent(space.sharedId)}/goals`
      : "/goals";

  const buildAccountHref = (accountId: string) => {
    const params = new URLSearchParams();
    params.set("accountId", accountId);
    return `${accountsBasePath}?${params.toString()}`;
  };

  const buildGoalHref = (goalId: string) => {
    const params = new URLSearchParams();
    params.set("goalId", goalId);
    params.set("highlightGoalId", goalId);
    return `${goalsBasePath}?${params.toString()}`;
  };

  const buildPositionHref = (positionId: string, accountId: string) => {
    const params = new URLSearchParams();
    params.set("accountId", accountId);
    params.set("drawer", "position");
    params.set("positionId", positionId);
    return `${accountsBasePath}?${params.toString()}`;
  };

  const assetDonutStyle = useMemo(() => {
    if (assetSummary.length === 0) {
      return {};
    }
    let offset = 0;
    const segments = assetSummary.map((item, index) => {
      const isLast = index === assetSummary.length - 1;
      const nextOffset = isLast ? 100 : offset + item.ratio * 100;
      const segment = `${item.color} ${offset}% ${nextOffset}%`;
      offset = nextOffset;
      return segment;
    });
    return {
      background: `conic-gradient(${segments.join(", ")})`,
    };
  }, [assetSummary]);

  useEffect(() => {
    if (!isOnline) {
      setActivityItems([]);
      setActivityError("Recent activity is unavailable offline.");
      setActivityLoading(false);
      return;
    }
    if (!isSignedIn) {
      setActivityItems([]);
      setActivityError("Sign in to view recent activity.");
      setActivityLoading(false);
      return;
    }
    const requestId = activityRequestRef.current + 1;
    activityRequestRef.current = requestId;
    setActivityLoading(true);
    setActivityError(null);
    void (async () => {
      try {
        const page = await loadHistoryPage({ limit: ACTIVITY_LIMIT });
        if (activityRequestRef.current !== requestId) {
          return;
        }
        setActivityItems(page.items);
      } catch (err) {
        if (activityRequestRef.current !== requestId) {
          return;
        }
        setActivityItems([]);
        setActivityError(err instanceof Error ? err.message : "Could not load activity.");
      } finally {
        if (activityRequestRef.current === requestId) {
          setActivityLoading(false);
        }
      }
    })();
  }, [isOnline, isSignedIn, loadHistoryPage, space.scope, space.sharedId, latestEvent?.id]);

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
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <div className="dashboard-section-heading">
                <h2>Goals</h2>
                <span className="app-muted">Top {GOAL_LIMIT}</span>
              </div>
            </div>
            {goals.length === 0 ? (
              <div className="section-stack">
                <div className="app-muted">No goals yet.</div>
                <Link href={goalsBasePath} className="dashboard-link">
                  Open goals
                </Link>
              </div>
            ) : (
              <div className="section-stack">
                <div className="dashboard-goal-grid">
                  {goalCards.map((goal) => (
                    <Link
                      key={goal.id}
                      href={buildGoalHref(goal.id)}
                      className="dashboard-goal-card dashboard-card-link"
                    >
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
                    </Link>
                  ))}
                </div>
                <Link href={goalsBasePath} className="dashboard-link">
                  Open goals
                </Link>
              </div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <div className="dashboard-section-heading">
                <h2>Quick updates</h2>
                <span className="app-muted">Last {QUICK_UPDATE_LIMIT}</span>
              </div>
            </div>
            {recentPositions.length === 0 ? (
              <div className="section-stack">
                <div className="app-muted">No recent positions yet.</div>
                <Link href={accountsBasePath} className="dashboard-link">
                  Open accounts
                </Link>
              </div>
            ) : (
              <div className="dashboard-list">
                {recentPositions.map((position) => (
                  <Link
                    key={position.id}
                    href={buildPositionHref(position.id, position.accountId)}
                    className="dashboard-list-item dashboard-list-link"
                  >
                    <div>
                      <div className="dashboard-list-title">{position.label}</div>
                      <div className="app-muted">
                        {accountNameById.get(position.accountId) ?? "Unknown account"} · Updated{" "}
                        {formatRelativeTimestamp(position.updatedAt, now)}
                      </div>
                    </div>
                    <div className="dashboard-list-value">
                      {formatCurrency(position.marketValue)}
                    </div>
                  </Link>
                ))}
                <Link
                  href={accountsBasePath}
                  className="dashboard-list-item dashboard-list-link dashboard-list-cta"
                >
                  <div className="dashboard-list-title">Open accounts</div>
                </Link>
              </div>
            )}
          </section>
        </div>

        <div className="dashboard-side">
          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <div className="dashboard-section-heading">
                <h2>Assets overview</h2>
                {assetTab === "account" ? (
                  <span className="app-muted">Top {ACCOUNT_LIMIT}</span>
                ) : null}
              </div>
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
              accountSummaryTop.length === 0 ? (
                <div className="section-stack">
                  <div className="app-muted">No accounts yet.</div>
                  <Link href={accountsBasePath} className="dashboard-link">
                    Open accounts
                  </Link>
                </div>
              ) : (
                <div className="dashboard-list">
                  {accountSummaryTop.map((account) => (
                    <Link
                      key={account.id}
                      href={buildAccountHref(account.id)}
                      className="dashboard-list-item dashboard-list-link"
                    >
                      <div>
                        <div className="dashboard-list-title">{account.name}</div>
                        <div className="app-muted">{account.positionCount} positions</div>
                      </div>
                      <div className="dashboard-list-value">
                        <div>{formatCurrency(account.total)}</div>
                        <div className="app-muted">Unallocated {formatCurrency(account.free)}</div>
                      </div>
                    </Link>
                  ))}
                  <Link
                    href={accountsBasePath}
                    className="dashboard-list-item dashboard-list-link dashboard-list-cta"
                  >
                    <div className="dashboard-list-title">Open accounts</div>
                  </Link>
                </div>
              )
            ) : assetSummary.length === 0 ? (
              <div className="app-muted">No assets yet.</div>
            ) : (
              <div className="dashboard-asset-layout">
                <div
                  className="dashboard-donut"
                  style={assetDonutStyle}
                  role="img"
                  aria-label="Asset breakdown"
                >
                  <div className="dashboard-donut-center">
                    <div className="dashboard-donut-label">Total</div>
                    <div className="dashboard-donut-value">
                      {formatCurrency(totals.totalAssets)}
                    </div>
                  </div>
                </div>
                <div className="dashboard-legend">
                  {assetSummary.map((asset) => (
                    <div key={asset.assetType} className="dashboard-legend-item">
                      <span
                        className="dashboard-legend-swatch"
                        style={{ background: asset.color }}
                        aria-hidden
                      />
                      <div className="dashboard-legend-text">
                        <div className="dashboard-legend-title">{asset.label}</div>
                        <div className="dashboard-legend-sub">
                          <span className="dashboard-legend-amount">
                            {formatCurrency(asset.total)}
                          </span>
                          <span className="dashboard-legend-ratio app-muted">
                            {formatPercent(asset.ratio)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="app-surface dashboard-section">
            <div className="dashboard-section-header">
              <div className="dashboard-section-heading">
                <h2>Recent activity</h2>
                <span className="app-muted">Last {ACTIVITY_LIMIT}</span>
              </div>
            </div>
            {activityLoading && activityItems.length === 0 ? (
              <div className="app-muted">Loading recent activity...</div>
            ) : activityError ? (
              <div className="app-muted">{activityError}</div>
            ) : activityItems.length === 0 ? (
              <div className="app-muted">
                No recent activity yet. Showing the last {ACTIVITY_LIMIT} entries when available.
              </div>
            ) : (
              <div className="dashboard-activity-list">
                {activityItems.map((item) => (
                  <div key={item.id} className="dashboard-activity-item">
                    <div className="dashboard-activity-main">
                      <div className="dashboard-activity-summary">{item.summary}</div>
                      <div className="dashboard-activity-meta">
                        <span
                          className={`history-origin-badge ${
                            item.origin === "system"
                              ? "history-origin-badge-system"
                              : "history-origin-badge-user"
                          }`}
                        >
                          {toHistoryOriginLabel(item.origin)}
                        </span>
                        {typeof item.amountDelta === "number" ? (
                          <span className="dashboard-activity-delta">
                            {formatDelta(item.amountDelta)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="dashboard-activity-time">
                      {formatRelativeTimestamp(item.timestamp, now)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {leaseError ? (
            <section className="app-surface dashboard-section">
              <h2>Lease status</h2>
              <div className="app-alert" role="status">
                <div>{leaseError}</div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <Link href={accountsBasePath} className="dashboard-fab" aria-label="Add account or position">
        +
      </Link>
    </div>
  );
}
