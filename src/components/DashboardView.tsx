"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DataContextValue } from "@/components/dataContext";
import { useStorageProviderContext } from "@/components/StorageProviderContext";
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
import { buildSharedRouteKey } from "@/lib/storage/sharedRoute";
import { useNow } from "@/lib/time/useNow";

const ACTIVITY_LIMIT = 5;
const GOAL_LIMIT = 5;
const ACCOUNT_LIMIT = 5;
const QUICK_UPDATE_LIMIT = 5;
const ASSET_ACCORDION_STORAGE_KEY = "mazemaze-dashboard-accordion-assets";
const ACTIVITY_ACCORDION_STORAGE_KEY = "mazemaze-dashboard-accordion-activity";

const readAccordionState = (key: string, defaultOpen: boolean): boolean => {
  if (typeof window === "undefined") {
    return defaultOpen;
  }
  const stored = window.localStorage.getItem(key);
  if (stored === "open") {
    return true;
  }
  if (stored === "closed") {
    return false;
  }
  return defaultOpen;
};

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
  const { activeProviderId } = useStorageProviderContext();
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
  const mostRecentPosition = recentPositions[0] ?? null;
  const remainingRecentPositions = recentPositions.slice(1, 3);
  const quickUpdatesShownCount = Math.min(recentPositions.length, 3);
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
  const [assetsAccordionOpen, setAssetsAccordionOpen] = useState(false);
  const [activityAccordionOpen, setActivityAccordionOpen] = useState(false);
  const [accordionsLoaded, setAccordionsLoaded] = useState(false);

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
  const assetsSummaryLine = useMemo(() => {
    if (assetSummary.length === 0) {
      return "No assets yet.";
    }
    const topAsset = assetSummary[0];
    return `Total ${formatCurrency(totals.totalAssets)} · Top: ${topAsset.label} ${formatPercent(
      topAsset.ratio,
    )}`;
  }, [assetSummary, totals.totalAssets]);
  const activitySummaryLine = useMemo(() => {
    if (activityLoading && activityItems.length === 0) {
      return "Loading recent activity...";
    }
    if (activityError) {
      return activityError;
    }
    if (activityItems.length === 0) {
      return "No recent activity yet.";
    }
    const latest = activityItems[0];
    return `Last: ${latest.summary} · ${formatRelativeTimestamp(latest.timestamp, now)}`;
  }, [activityError, activityItems, activityLoading, now]);

  const accountsBasePath =
    space.scope === "shared" && space.sharedId
      ? `/shared/${encodeURIComponent(buildSharedRouteKey(activeProviderId, space.sharedId))}/accounts`
      : "/accounts";
  const goalsBasePath =
    space.scope === "shared" && space.sharedId
      ? `/shared/${encodeURIComponent(buildSharedRouteKey(activeProviderId, space.sharedId))}/goals`
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setAssetsAccordionOpen(readAccordionState(ASSET_ACCORDION_STORAGE_KEY, false));
    setActivityAccordionOpen(readAccordionState(ACTIVITY_ACCORDION_STORAGE_KEY, false));
    setAccordionsLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !accordionsLoaded) {
      return;
    }
    window.localStorage.setItem(
      ASSET_ACCORDION_STORAGE_KEY,
      assetsAccordionOpen ? "open" : "closed",
    );
  }, [accordionsLoaded, assetsAccordionOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || !accordionsLoaded) {
      return;
    }
    window.localStorage.setItem(
      ACTIVITY_ACCORDION_STORAGE_KEY,
      activityAccordionOpen ? "open" : "closed",
    );
  }, [accordionsLoaded, activityAccordionOpen]);

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

        <div className="dashboard-summary-mobile dashboard-mobile-only">
          <div className="dashboard-summary-card dashboard-summary-compact">
            <div className="app-muted">Total assets</div>
            <div className="dashboard-summary-value">{formatCurrency(totals.totalAssets)}</div>
            <div className="dashboard-summary-inline">
              <span className="dashboard-summary-inline-item">
                Allocated {formatCurrency(totals.allocated)}
              </span>
              <span className="dashboard-summary-inline-item">
                Unallocated {formatCurrency(totals.unallocated)}
              </span>
            </div>
          </div>
        </div>
        <div className="dashboard-summary-grid dashboard-summary-desktop">
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
                <h2>Recent position updates</h2>
                <span className="app-muted">Last {QUICK_UPDATE_LIMIT}</span>
              </div>
            </div>
            {recentPositions.length === 0 ? (
              <div className="section-stack">
                <div className="app-muted">No recent updates yet.</div>
                <Link href={accountsBasePath} className="dashboard-link">
                  Open accounts
                </Link>
              </div>
            ) : (
              <>
                <div className="dashboard-list dashboard-quick-desktop">
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
                <div className="dashboard-quick-mobile dashboard-mobile-only">
                  {mostRecentPosition ? (
                    <Link
                      href={buildPositionHref(mostRecentPosition.id, mostRecentPosition.accountId)}
                      className="dashboard-quick-card dashboard-card-link"
                    >
                      <div className="dashboard-quick-card-label app-muted">Most recent update</div>
                      <div className="dashboard-quick-card-body">
                        <div>
                          <div className="dashboard-quick-card-title">
                            {mostRecentPosition.label}
                          </div>
                          <div className="app-muted">
                            {accountNameById.get(mostRecentPosition.accountId) ?? "Unknown account"}{" "}
                            · Updated {formatRelativeTimestamp(mostRecentPosition.updatedAt, now)}
                          </div>
                        </div>
                        <div className="dashboard-quick-card-value">
                          {formatCurrency(mostRecentPosition.marketValue)}
                        </div>
                      </div>
                    </Link>
                  ) : null}
                  {remainingRecentPositions.length > 0 ? (
                    <div className="dashboard-quick-grid">
                      {remainingRecentPositions.map((position) => (
                        <Link
                          key={position.id}
                          href={buildPositionHref(position.id, position.accountId)}
                          className="dashboard-quick-tile dashboard-list-link"
                        >
                          <div>
                            <div className="dashboard-quick-tile-title">{position.label}</div>
                            <div className="app-muted">
                              {accountNameById.get(position.accountId) ?? "Unknown account"} ·
                              Updated {formatRelativeTimestamp(position.updatedAt, now)}
                            </div>
                          </div>
                          <div className="dashboard-quick-tile-value">
                            {formatCurrency(position.marketValue)}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {quickUpdatesShownCount > 0 ? (
                    <div className="dashboard-quick-footer app-muted">
                      Showing {quickUpdatesShownCount} of last {QUICK_UPDATE_LIMIT}
                    </div>
                  ) : null}
                  <Link
                    href={accountsBasePath}
                    className="dashboard-list-item dashboard-list-link dashboard-list-cta"
                  >
                    <div className="dashboard-list-title">Open accounts</div>
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="dashboard-side">
          <section
            className="app-surface dashboard-section dashboard-accordion"
            data-open={assetsAccordionOpen ? "true" : "false"}
          >
            <button
              type="button"
              className="dashboard-accordion-header dashboard-mobile-only"
              onClick={() => setAssetsAccordionOpen((prev) => !prev)}
              aria-expanded={assetsAccordionOpen}
              aria-controls="dashboard-assets-body"
            >
              <div className="dashboard-accordion-heading">
                <div className="dashboard-accordion-title">
                  <span className="dashboard-accordion-title-text">Assets overview</span>
                </div>
                <div className="dashboard-accordion-summary">{assetsSummaryLine}</div>
              </div>
              <span className="dashboard-accordion-chevron" aria-hidden>
                ›
              </span>
            </button>
            <div id="dashboard-assets-body" className="dashboard-accordion-body">
              <div className="dashboard-section-header">
                <div className="dashboard-section-heading">
                  <h2>Assets overview</h2>
                  {assetTab === "account" ? (
                    <span className="app-muted">Top {ACCOUNT_LIMIT}</span>
                  ) : null}
                </div>
                <div
                  className="dashboard-tabs dashboard-tabs-desktop"
                  role="tablist"
                  aria-label="Assets overview"
                >
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
              <div
                className="dashboard-tabs dashboard-tabs-mobile dashboard-mobile-only"
                role="tablist"
                aria-label="Assets overview"
              >
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
                          <div className="app-muted">
                            Unallocated {formatCurrency(account.free)}
                          </div>
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
            </div>
          </section>

          <section
            className="app-surface dashboard-section dashboard-accordion"
            data-open={activityAccordionOpen ? "true" : "false"}
          >
            <button
              type="button"
              className="dashboard-accordion-header dashboard-mobile-only"
              onClick={() => setActivityAccordionOpen((prev) => !prev)}
              aria-expanded={activityAccordionOpen}
              aria-controls="dashboard-activity-body"
            >
              <div className="dashboard-accordion-heading">
                <div className="dashboard-accordion-title">
                  <span className="dashboard-accordion-title-text">Recent activity</span>
                </div>
                <div className="dashboard-accordion-summary">{activitySummaryLine}</div>
              </div>
              <span className="dashboard-accordion-chevron" aria-hidden>
                ›
              </span>
            </button>
            <div id="dashboard-activity-body" className="dashboard-accordion-body">
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
            </div>
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
    </div>
  );
}
