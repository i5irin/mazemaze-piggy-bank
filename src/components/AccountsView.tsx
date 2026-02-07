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
import {
  formatCurrency,
  formatIntegerInput,
  getIntegerInputError,
  parseIntegerInput,
} from "@/lib/numberFormat";
import type { HistoryItem } from "@/lib/persistence/history";
import type { AssetType, Position } from "@/lib/persistence/types";

const assetTypeOptions: { value: AssetType; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "deposit", label: "Deposit" },
  { value: "fx", label: "FX" },
  { value: "securities", label: "Securities" },
  { value: "crypto", label: "Crypto" },
  { value: "payout", label: "Insurance/Pension" },
  { value: "stored", label: "Stored Value" },
  { value: "other", label: "Other" },
];

const allocationModeOptions: { value: Position["allocationMode"]; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "ratio", label: "Ratio" },
  { value: "priority", label: "Priority" },
];

const assetTypeLabels = new Map(assetTypeOptions.map((option) => [option.value, option.label]));
const allocationModeLabels = new Map(
  allocationModeOptions.map((option) => [option.value, option.label]),
);

type DrawerState =
  | { type: "closed" }
  | { type: "addAccount" }
  | { type: "editAccount"; accountId: string }
  | { type: "addPosition"; accountId: string }
  | { type: "positionDetails"; positionId: string };

type PositionTab = "details" | "allocations" | "history";

type InlineEditState = {
  positionId: string;
  value: string;
  originalValue: number;
  isSaving: boolean;
};

type MobileScreen = "accounts" | "account";

const isPositionTab = (value: string | null): value is PositionTab =>
  value === "details" || value === "allocations" || value === "history";

const HISTORY_PAGE_SIZE = 20;

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

const formatAbsoluteTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US", { hour12: false });
};

const formatRelativeTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  const diffMs = parsed.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMinutes < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) {
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

const toSaveFailureMessage = (reason: string, fallback?: string): string => {
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

export function AccountsView({ data }: { data: DataContextValue }) {
  const {
    draftState,
    isOnline,
    isSignedIn,
    canWrite,
    isRevalidating,
    activity,
    createAccount,
    updateAccount,
    deleteAccount,
    createPosition,
    updatePosition,
    deletePosition,
    loadHistoryPage,
    saveChanges,
    discardChanges,
  } = data;

  const canEdit = isOnline && isSignedIn && canWrite;
  const editNotice = getEditNotice(data);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const returnGoalId = searchParams.get("returnGoalId");
  const returnTab = searchParams.get("returnTab") ?? "allocations";

  const accounts = useMemo(() => draftState?.accounts ?? [], [draftState?.accounts]);
  const positions = useMemo(() => draftState?.positions ?? [], [draftState?.positions]);
  const allocations = useMemo(() => draftState?.allocations ?? [], [draftState?.allocations]);
  const goals = useMemo(() => draftState?.goals ?? [], [draftState?.goals]);

  const [drawer, setDrawer] = useState<DrawerState>({ type: "closed" });
  const [positionTab, setPositionTab] = useState<PositionTab>("details");
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("accounts");
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [showInlineHint, setShowInlineHint] = useState(false);
  const inlineHintShownRef = useRef(false);
  const saveChangesRef = useRef(saveChanges);
  const discardChangesRef = useRef(discardChanges);
  const skipQueryRestoreRef = useRef(false);

  const [accountFormName, setAccountFormName] = useState("");
  const [positionFormLabel, setPositionFormLabel] = useState("");
  const [positionFormAssetType, setPositionFormAssetType] = useState<AssetType>("cash");
  const [positionFormMarketValue, setPositionFormMarketValue] = useState("0");
  const [positionDetailsLabel, setPositionDetailsLabel] = useState("");
  const [positionDetailsAssetType, setPositionDetailsAssetType] = useState<AssetType>("cash");
  const [positionDetailsAllocationMode, setPositionDetailsAllocationMode] =
    useState<Position["allocationMode"]>("fixed");
  const [highlightedPositionId, setHighlightedPositionId] = useState<string | null>(null);
  const pendingNewAccountIdsRef = useRef<Set<string> | null>(null);
  const pendingNewPositionIdsRef = useRef<{ accountId: string; ids: Set<string> } | null>(null);

  useEffect(() => {
    saveChangesRef.current = saveChanges;
    discardChangesRef.current = discardChanges;
  }, [discardChanges, saveChanges]);

  const allocationTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const allocation of allocations) {
      totals[allocation.positionId] =
        (totals[allocation.positionId] ?? 0) + allocation.allocatedAmount;
    }
    return totals;
  }, [allocations]);

  const queryAccountId = searchParams.get("accountId");
  const queryPositionTab = searchParams.get("positionTab");
  const effectiveAccountId = useMemo(() => {
    if (queryAccountId && accounts.some((account) => account.id === queryAccountId)) {
      return queryAccountId;
    }
    return accounts[0]?.id ?? null;
  }, [accounts, queryAccountId]);

  const selectedAccount = accounts.find((account) => account.id === effectiveAccountId) ?? null;

  const positionsForAccount = useMemo(() => {
    if (!selectedAccount) {
      return [];
    }
    return positions.filter((position) => position.accountId === selectedAccount.id);
  }, [positions, selectedAccount]);
  const mobilePositionsForAccount = useMemo(
    () => [...positionsForAccount].reverse(),
    [positionsForAccount],
  );

  const selectedAccountTotals = useMemo(() => {
    if (!selectedAccount) {
      return { total: 0, allocated: 0, free: 0, count: 0 };
    }
    const accountPositions = positions.filter(
      (position) => position.accountId === selectedAccount.id,
    );
    const total = accountPositions.reduce((sum, position) => sum + position.marketValue, 0);
    const allocated = accountPositions.reduce(
      (sum, position) => sum + (allocationTotals[position.id] ?? 0),
      0,
    );
    return {
      total,
      allocated,
      free: Math.max(0, total - allocated),
      count: accountPositions.length,
    };
  }, [allocationTotals, positions, selectedAccount]);

  const accountsSummary = useMemo(() => {
    return accounts.map((account) => {
      const accountPositions = positions.filter((position) => position.accountId === account.id);
      const total = accountPositions.reduce((sum, position) => sum + position.marketValue, 0);
      const allocated = accountPositions.reduce(
        (sum, position) => sum + (allocationTotals[position.id] ?? 0),
        0,
      );
      return {
        account,
        total,
        allocated,
        free: Math.max(0, total - allocated),
        count: accountPositions.length,
      };
    });
  }, [accounts, allocationTotals, positions]);

  const selectedPosition =
    drawer.type === "positionDetails"
      ? (positions.find((position) => position.id === drawer.positionId) ?? null)
      : null;
  const selectedPositionId = selectedPosition?.id ?? null;

  const selectedPositionAllocations = useMemo(() => {
    if (!selectedPosition) {
      return [];
    }
    return allocations
      .filter((allocation) => allocation.positionId === selectedPosition.id)
      .map((allocation) => ({
        ...allocation,
        goalName: goals.find((goal) => goal.id === allocation.goalId)?.name ?? "Unknown goal",
      }));
  }, [allocations, goals, selectedPosition]);

  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestSeqRef = useRef(0);

  const updateQuery = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutator(params);
      const next = params.toString();
      router.replace(next.length > 0 ? `${pathname}?${next}` : pathname);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (accounts.length === 0) {
      return;
    }
    if (queryAccountId && accounts.some((account) => account.id === queryAccountId)) {
      return;
    }
    const fallbackAccountId = accounts[0]?.id;
    if (!fallbackAccountId) {
      return;
    }
    updateQuery((params) => {
      params.set("accountId", fallbackAccountId);
      params.delete("drawer");
      params.delete("positionId");
      params.delete("positionTab");
    });
  }, [accounts, queryAccountId, updateQuery]);

  const getReturnGoalsPath = useCallback(() => {
    if (!returnGoalId) {
      return null;
    }
    const goalsPath = pathname.endsWith("/accounts")
      ? pathname.slice(0, pathname.length - "/accounts".length) + "/goals"
      : "/goals";
    const params = new URLSearchParams();
    params.set("goalId", returnGoalId);
    params.set("tab", returnTab);
    return `${goalsPath}?${params.toString()}`;
  }, [pathname, returnGoalId, returnTab]);

  const navigateBackToGoal = useCallback(() => {
    const target = getReturnGoalsPath();
    if (!target) {
      return;
    }
    router.push(target);
  }, [getReturnGoalsPath, router]);

  const positionDetailsDirty = Boolean(
    selectedPosition &&
    (positionDetailsLabel !== selectedPosition.label ||
      positionDetailsAssetType !== selectedPosition.assetType ||
      positionDetailsAllocationMode !== selectedPosition.allocationMode),
  );

  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const pendingCloseActionRef = useRef<"close" | "back" | null>(null);

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
    setErrorMessage(toSaveFailureMessage(outcome.reason, outcome.error));
    return false;
  };

  const runMutation = async (
    apply: () => DomainActionOutcome,
    options: { rollbackOnFailure?: boolean } = { rollbackOnFailure: true },
  ): Promise<boolean> => {
    const result = apply();
    if (!result.ok) {
      setErrorMessage(result.error);
      return false;
    }
    const persisted = await persistOperation(true);
    if (!persisted && options.rollbackOnFailure) {
      discardChangesRef.current();
    }
    return persisted;
  };

  const startInlineEdit = (position: Position) => {
    if (!canEdit || activity !== "idle") {
      return;
    }
    setInlineEdit({
      positionId: position.id,
      value: formatIntegerInput(position.marketValue.toString()),
      originalValue: position.marketValue,
      isSaving: false,
    });
    if (!inlineHintShownRef.current) {
      inlineHintShownRef.current = true;
      setShowInlineHint(true);
      window.setTimeout(() => setShowInlineHint(false), 2600);
    }
  };

  const cancelInlineEdit = () => {
    setInlineEdit(null);
  };

  const commitInlineEdit = async () => {
    if (!inlineEdit) {
      return;
    }
    const position = positions.find((item) => item.id === inlineEdit.positionId);
    if (!position) {
      setInlineEdit(null);
      return;
    }
    const parsed = parseIntegerInput(inlineEdit.value);
    if (parsed === null) {
      setErrorMessage("Market value must be a non-negative integer.");
      return;
    }

    setInlineEdit((prev) => (prev ? { ...prev, isSaving: true } : prev));
    const persisted = await runMutation(
      () =>
        updatePosition({
          positionId: position.id,
          assetType: position.assetType,
          label: position.label,
          marketValue: parsed,
          allocationMode: position.allocationMode,
        }),
      { rollbackOnFailure: true },
    );
    if (persisted) {
      setInlineEdit(null);
      return;
    }
    setInlineEdit({
      positionId: position.id,
      value: formatIntegerInput(inlineEdit.originalValue.toString()),
      originalValue: inlineEdit.originalValue,
      isSaving: false,
    });
    window.setTimeout(() => setInlineEdit(null), 0);
  };

  const positionFormError = getIntegerInputError(positionFormMarketValue, { required: true });
  const inlineError = inlineEdit
    ? getIntegerInputError(inlineEdit.value, { required: true })
    : null;

  const openAddPositionDrawer = () => {
    if (!selectedAccount) {
      return;
    }
    setIsFabMenuOpen(false);
    setPositionFormLabel("");
    setPositionFormAssetType("cash");
    setPositionFormMarketValue("0");
    setDrawer({ type: "addPosition", accountId: selectedAccount.id });
  };

  const openAddAccountDrawer = () => {
    setIsFabMenuOpen(false);
    setAccountFormName("");
    setDrawer({ type: "addAccount" });
  };

  const openEditAccountDrawer = (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    setAccountFormName(account?.name ?? "");
    setDrawer({ type: "editAccount", accountId });
  };

  const openPositionDetailsDrawer = (
    position: Position,
    options?: { fromQuery?: boolean; tab?: PositionTab },
  ) => {
    skipQueryRestoreRef.current = false;
    setPositionDetailsLabel(position.label);
    setPositionDetailsAssetType(position.assetType);
    setPositionDetailsAllocationMode(position.allocationMode);
    const nextTab = options?.tab ?? "details";
    setPositionTab(nextTab);
    setDrawer({ type: "positionDetails", positionId: position.id });
    if (options?.fromQuery) {
      return;
    }
    updateQuery((params) => {
      params.set("drawer", "position");
      params.set("positionId", position.id);
      params.set("accountId", position.accountId);
      params.set("positionTab", nextTab);
    });
  };

  const selectAccount = useCallback(
    (accountId: string) => {
      setInlineEdit(null);
      setMobileScreen("account");
      updateQuery((params) => {
        params.set("accountId", accountId);
        params.delete("drawer");
        params.delete("positionId");
        params.delete("positionTab");
      });
    },
    [updateQuery],
  );

  const finalizeCloseDrawer = useCallback(() => {
    skipQueryRestoreRef.current = true;
    setDrawer({ type: "closed" });
    updateQuery((params) => {
      params.delete("drawer");
      params.delete("positionId");
      params.delete("positionTab");
      if (!returnGoalId) {
        params.delete("returnGoalId");
        params.delete("returnTab");
      }
    });
    if (returnGoalId) {
      navigateBackToGoal();
    }
  }, [navigateBackToGoal, returnGoalId, updateQuery]);

  const requestClosePositionDrawer = useCallback(
    (mode: "close" | "back") => {
      if (positionDetailsDirty) {
        pendingCloseActionRef.current = mode;
        setDiscardDialogOpen(true);
        return;
      }
      finalizeCloseDrawer();
    },
    [finalizeCloseDrawer, positionDetailsDirty],
  );

  const closeDrawer = useCallback(() => {
    if (drawer.type === "positionDetails") {
      requestClosePositionDrawer("close");
      return;
    }
    setDrawer({ type: "closed" });
  }, [drawer.type, requestClosePositionDrawer]);

  const retrySave = async () => {
    const persisted = await persistOperation(false);
    if (persisted) {
      setRetryPending(false);
    }
  };

  const loadInitialHistory = useCallback(
    async (positionId: string) => {
      const requestId = historyRequestSeqRef.current + 1;
      historyRequestSeqRef.current = requestId;
      setHistoryItems([]);
      setHistoryCursor(null);
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const page = await loadHistoryPage({
          limit: HISTORY_PAGE_SIZE,
          filter: { positionId },
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
    if (!selectedPositionId || !historyCursor) {
      return;
    }
    const requestId = historyRequestSeqRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await loadHistoryPage({
        limit: HISTORY_PAGE_SIZE,
        cursor: historyCursor,
        filter: { positionId: selectedPositionId },
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
  }, [historyCursor, loadHistoryPage, selectedPositionId]);

  useEffect(() => {
    if (drawer.type === "closed") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, drawer.type]);

  useEffect(() => {
    const pendingAccountIds = pendingNewAccountIdsRef.current;
    if (pendingAccountIds) {
      const created = accounts.find((account) => !pendingAccountIds.has(account.id));
      if (created) {
        selectAccount(created.id);
        pendingNewAccountIdsRef.current = null;
      }
    }
  }, [accounts, selectAccount]);

  useEffect(() => {
    const pendingPosition = pendingNewPositionIdsRef.current;
    if (pendingPosition) {
      const created = positions.find(
        (position) =>
          position.accountId === pendingPosition.accountId && !pendingPosition.ids.has(position.id),
      );
      if (created) {
        setHighlightedPositionId(created.id);
        setMobileScreen("account");
        pendingNewPositionIdsRef.current = null;
      }
    }
  }, [positions]);

  useEffect(() => {
    if (!highlightedPositionId) {
      return;
    }
    const timerId = window.setTimeout(() => setHighlightedPositionId(null), 1800);
    return () => window.clearTimeout(timerId);
  }, [highlightedPositionId]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const drawerFromQuery = searchParams.get("drawer");
      const positionIdFromQuery = searchParams.get("positionId");
      if (drawerFromQuery !== "position" || !positionIdFromQuery) {
        skipQueryRestoreRef.current = false;
        return;
      }
      if (skipQueryRestoreRef.current) {
        return;
      }
      const position = positions.find((item) => item.id === positionIdFromQuery);
      if (!position) {
        return;
      }
      if (drawer.type === "positionDetails" && drawer.positionId === position.id) {
        return;
      }
      skipQueryRestoreRef.current = false;
      setPositionDetailsLabel(position.label);
      setPositionDetailsAssetType(position.assetType);
      setPositionDetailsAllocationMode(position.allocationMode);
      setPositionTab(isPositionTab(queryPositionTab) ? queryPositionTab : "details");
      setDrawer({ type: "positionDetails", positionId: position.id });
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [accounts, drawer, positions, queryPositionTab, searchParams]);

  useEffect(() => {
    if (!selectedPositionId || positionTab !== "history") {
      historyRequestSeqRef.current += 1;
      setHistoryItems([]);
      setHistoryCursor(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    void loadInitialHistory(selectedPositionId);
  }, [loadInitialHistory, positionTab, selectedPositionId]);

  const submitAddAccount = () => {
    if (accountFormName.trim().length === 0) {
      setErrorMessage("Account name is required.");
      return;
    }
    pendingNewAccountIdsRef.current = new Set(accounts.map((account) => account.id));
    closeDrawer();
    void runMutation(() => createAccount(accountFormName));
  };

  const submitAddPosition = (accountId: string) => {
    const parsed = parseIntegerInput(positionFormMarketValue);
    if (parsed === null) {
      setErrorMessage("Market value must be a non-negative integer.");
      return;
    }
    pendingNewPositionIdsRef.current = {
      accountId,
      ids: new Set(
        positions.filter((position) => position.accountId === accountId).map((item) => item.id),
      ),
    };
    setMobileScreen("account");
    closeDrawer();
    void runMutation(() =>
      createPosition({
        accountId,
        assetType: positionFormAssetType,
        label: positionFormLabel,
        marketValue: parsed,
      }),
    );
  };

  const fabPositionDisabledReason = !canEdit
    ? editNotice
    : mobileScreen !== "account"
      ? "Open an account first."
      : !selectedAccount
        ? "Select an account first."
        : null;

  return (
    <div className="section-stack accounts-page">
      {editNotice ? (
        <div className="app-alert" role="status">
          <Text>{editNotice}</Text>
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

      {isRevalidating ? (
        <div className="app-alert" role="status">
          <Text>Refreshing...</Text>
        </div>
      ) : null}

      <div className="accounts-mobile-only section-stack">
        {mobileScreen === "accounts" ? (
          <section className="app-surface">
            <div className="accounts-pane-header">
              <h2>Accounts</h2>
            </div>
            {accountsSummary.length === 0 ? (
              <div className="accounts-empty-card">
                <h3>No accounts yet</h3>
                <p className="app-muted">Add an account to start tracking your positions.</p>
                <Button appearance="primary" onClick={openAddAccountDrawer} disabled={!canEdit}>
                  Add account
                </Button>
              </div>
            ) : (
              <div className="section-stack">
                {accountsSummary.map(({ account, total, free, count }) => (
                  <button
                    key={account.id}
                    type="button"
                    className="accounts-mobile-account-card"
                    onClick={() => {
                      selectAccount(account.id);
                    }}
                  >
                    <div>
                      <div className="accounts-master-name">{account.name}</div>
                      <div className="app-muted">{count} positions</div>
                      <div className="app-muted">Unallocated {formatCurrency(free)}</div>
                    </div>
                    <div className="accounts-master-total">{formatCurrency(total)}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="app-surface">
            <div className="accounts-pane-header">
              <div className="accounts-mobile-title">
                <Button
                  appearance="secondary"
                  size="small"
                  onClick={() => setMobileScreen("accounts")}
                >
                  Back
                </Button>
                <h2>{selectedAccount ? `Positions in ${selectedAccount.name}` : "Positions"}</h2>
              </div>
              <span
                className="accounts-info-icon"
                aria-label="Inline edit help"
                title={"Enter to save · Esc to cancel\nJPY integer only."}
              >
                ⓘ
              </span>
            </div>

            {selectedAccount ? (
              <div className="accounts-summary-bar">
                <div className="accounts-summary-name">{selectedAccount.name}</div>
                <div>Total {formatCurrency(selectedAccountTotals.total)}</div>
                <div>Allocated {formatCurrency(selectedAccountTotals.allocated)}</div>
                <div>Unallocated {formatCurrency(selectedAccountTotals.free)}</div>
                <Button
                  size="small"
                  onClick={() => openEditAccountDrawer(selectedAccount.id)}
                  disabled={!canEdit}
                >
                  Edit account
                </Button>
              </div>
            ) : null}

            {!selectedAccount ? (
              <div className="app-muted">Select an account first.</div>
            ) : mobilePositionsForAccount.length === 0 ? (
              <div className="accounts-empty-card">
                <h3>No positions in this account</h3>
                <p className="app-muted">Add your first position (e.g., Deposit, Cash, FX).</p>
                <Button appearance="primary" onClick={openAddPositionDrawer} disabled={!canEdit}>
                  Add position
                </Button>
              </div>
            ) : (
              <div className="section-stack">
                {mobilePositionsForAccount.map((position) => {
                  const allocated = allocationTotals[position.id] ?? 0;
                  const free = Math.max(0, position.marketValue - allocated);
                  return (
                    <button
                      key={position.id}
                      type="button"
                      className={`accounts-mobile-position-card ${highlightedPositionId === position.id ? "accounts-mobile-position-card-highlight" : ""}`}
                      onClick={() => openPositionDetailsDrawer(position)}
                    >
                      <div className="accounts-position-label">{position.label}</div>
                      <div className="accounts-mobile-value">
                        {formatCurrency(position.marketValue)}
                      </div>
                      <div className="app-muted">
                        Allocated {formatCurrency(allocated)} · Unallocated {formatCurrency(free)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div className="accounts-mobile-fab">
          <Button
            appearance="primary"
            className="accounts-mobile-fab-button"
            onClick={() => setIsFabMenuOpen((open) => !open)}
            aria-label="Open add menu"
          >
            +
          </Button>
          {isFabMenuOpen ? (
            <div className="accounts-mobile-fab-menu">
              <Button
                onClick={openAddAccountDrawer}
                disabled={!canEdit}
                title={!canEdit ? (editNotice ?? undefined) : undefined}
              >
                🏦 Account
              </Button>
              <Button
                onClick={openAddPositionDrawer}
                disabled={!!fabPositionDisabledReason}
                title={fabPositionDisabledReason ?? undefined}
              >
                💰 Position
              </Button>
              {fabPositionDisabledReason ? (
                <div className="app-muted accounts-mobile-fab-reason">
                  {fabPositionDisabledReason}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="accounts-master-detail accounts-desktop-only">
        <section className="app-surface accounts-master-pane">
          <div className="accounts-pane-header">
            <h2>Accounts</h2>
            <Button
              appearance="primary"
              size="small"
              onClick={openAddAccountDrawer}
              disabled={!canEdit}
            >
              Add account
            </Button>
          </div>

          {accountsSummary.length === 0 ? (
            <div className="accounts-empty-card">
              <h3>No accounts yet</h3>
              <p className="app-muted">Add an account to start tracking your positions.</p>
              <Button appearance="primary" onClick={openAddAccountDrawer} disabled={!canEdit}>
                Add account
              </Button>
            </div>
          ) : (
            <div className="section-stack" role="listbox" aria-label="Accounts list">
              {accountsSummary.map(({ account, total, free, count }) => {
                const selected = selectedAccount?.id === account.id;
                return (
                  <div
                    key={account.id}
                    className={`accounts-master-item ${selected ? "accounts-master-item-selected" : ""}`}
                    role="option"
                    tabIndex={0}
                    aria-selected={selected}
                    onClick={() => {
                      selectAccount(account.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectAccount(account.id);
                      }
                    }}
                  >
                    <div>
                      <div className="accounts-master-name">{account.name}</div>
                      <div className="app-muted">{count} positions</div>
                      <div className="app-muted">Unallocated {formatCurrency(free)}</div>
                    </div>
                    <div className="accounts-master-total">{formatCurrency(total)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="app-surface accounts-detail-pane">
          <div className="accounts-pane-header accounts-detail-heading">
            <h2>{selectedAccount ? `Positions in ${selectedAccount.name}` : "Positions"}</h2>
            <div className="accounts-header-actions">
              <span
                className="accounts-info-icon"
                aria-label="Inline edit help"
                title={"Enter to save · Esc to cancel\nJPY integer only."}
              >
                ⓘ
              </span>
            </div>
          </div>

          {selectedAccount ? (
            <div className="accounts-summary-bar">
              <div className="accounts-summary-name">{selectedAccount.name}</div>
              <div>Total {formatCurrency(selectedAccountTotals.total)}</div>
              <div>Allocated {formatCurrency(selectedAccountTotals.allocated)}</div>
              <div>Unallocated {formatCurrency(selectedAccountTotals.free)}</div>
              <Button
                size="small"
                onClick={() => openEditAccountDrawer(selectedAccount.id)}
                disabled={!canEdit}
              >
                Edit account
              </Button>
              <Button
                size="small"
                appearance="secondary"
                onClick={openAddPositionDrawer}
                disabled={!canEdit}
              >
                Add position
              </Button>
            </div>
          ) : null}

          {!selectedAccount ? (
            <div className="app-muted">Select an account to view positions.</div>
          ) : positionsForAccount.length === 0 ? (
            <div className="accounts-empty-card">
              <h3>No positions in this account</h3>
              <p className="app-muted">Add your first position (e.g., Deposit, Cash, FX).</p>
              <Button appearance="primary" onClick={openAddPositionDrawer} disabled={!canEdit}>
                Add position
              </Button>
            </div>
          ) : (
            <div className="accounts-table" role="table" aria-label="Positions table">
              <div className="accounts-table-row accounts-table-header" role="row">
                <div role="columnheader">Label</div>
                <div role="columnheader">Value</div>
                <div role="columnheader">Recalc mode</div>
                <div role="columnheader">Last updated</div>
              </div>
              {positionsForAccount.map((position) => {
                const allocated = allocationTotals[position.id] ?? 0;
                const free = Math.max(0, position.marketValue - allocated);
                const editing = inlineEdit?.positionId === position.id;
                return (
                  <div
                    key={position.id}
                    className="accounts-table-row accounts-data-row"
                    role="row"
                    onClick={() => openPositionDetailsDrawer(position)}
                  >
                    <div role="cell">
                      <div className="accounts-position-label">{position.label}</div>
                      <div className="app-muted">
                        {assetTypeLabels.get(position.assetType) ?? position.assetType}
                      </div>
                    </div>

                    <div
                      role="cell"
                      className="accounts-value-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {editing && inlineEdit ? (
                        <div className="accounts-inline-editor">
                          <Input
                            inputMode="numeric"
                            value={inlineEdit.value}
                            disabled={!canEdit || inlineEdit.isSaving}
                            onChange={(_, eventData) =>
                              setInlineEdit((prev) =>
                                prev
                                  ? { ...prev, value: formatIntegerInput(eventData.value) }
                                  : prev,
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                if (!inlineError) {
                                  void commitInlineEdit();
                                }
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelInlineEdit();
                              }
                            }}
                            aria-label={`Edit market value for ${position.label}`}
                            autoFocus
                          />
                          {inlineEdit.isSaving ? <div className="app-muted">Saving...</div> : null}
                          {inlineError ? (
                            <div className="accounts-inline-error">{inlineError}</div>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="accounts-value-button"
                          onClick={() => startInlineEdit(position)}
                          disabled={!canEdit || activity !== "idle"}
                        >
                          <div className="accounts-value-main">
                            {formatCurrency(position.marketValue)}
                          </div>
                          <div className="app-muted">
                            Allocated {formatCurrency(allocated)} · Unallocated{" "}
                            {formatCurrency(free)}
                          </div>
                        </button>
                      )}
                      {showInlineHint && !editing ? (
                        <div className="accounts-inline-hint">Enter to save · Esc to cancel</div>
                      ) : null}
                    </div>

                    <div role="cell">
                      <span
                        className="accounts-mode-chip"
                        title="How allocations follow when the value changes."
                        aria-label="How allocations follow when the value changes."
                      >
                        {allocationModeLabels.get(position.allocationMode) ??
                          position.allocationMode}
                      </span>
                    </div>

                    <div role="cell">
                      <span
                        title={formatAbsoluteTimestamp(position.updatedAt)}
                        suppressHydrationWarning
                      >
                        {formatRelativeTimestamp(position.updatedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {drawer.type !== "closed" ? (
        <div className="accounts-drawer-overlay" onClick={closeDrawer}>
          <section
            className="accounts-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="accounts-drawer-header">
              <strong>
                {drawer.type === "addAccount"
                  ? "Add account"
                  : drawer.type === "editAccount"
                    ? "Edit account"
                    : drawer.type === "addPosition"
                      ? "Add position"
                      : (selectedPosition?.label ?? "Position details")}
              </strong>
              <div className="app-actions">
                {drawer.type === "positionDetails" && returnGoalId ? (
                  <Button onClick={() => requestClosePositionDrawer("back")}>Back to goal</Button>
                ) : null}
                <Button onClick={closeDrawer}>Close</Button>
              </div>
            </header>

            {drawer.type === "addAccount" ? (
              <div className="section-stack">
                <Field label="Account name">
                  <Input
                    value={accountFormName}
                    onChange={(_, eventData) => setAccountFormName(eventData.value)}
                    placeholder="Everyday Cash"
                    disabled={!canEdit || activity !== "idle"}
                  />
                </Field>
                <div className="app-actions">
                  <Button
                    appearance="primary"
                    disabled={!canEdit || activity !== "idle"}
                    onClick={submitAddAccount}
                  >
                    Add account
                  </Button>
                </div>
              </div>
            ) : null}

            {drawer.type === "editAccount" ? (
              <div className="section-stack">
                <Field label="Account name">
                  <Input
                    value={accountFormName}
                    onChange={(_, eventData) => setAccountFormName(eventData.value)}
                    disabled={!canEdit || activity !== "idle"}
                  />
                </Field>
                <div className="app-actions">
                  <Button
                    appearance="primary"
                    disabled={!canEdit || activity !== "idle"}
                    onClick={() => {
                      void runMutation(() => updateAccount(drawer.accountId, accountFormName)).then(
                        (persisted) => {
                          if (persisted) {
                            closeDrawer();
                          }
                        },
                      );
                    }}
                  >
                    Save account
                  </Button>
                  <Button
                    disabled={!canEdit || activity !== "idle"}
                    onClick={() => {
                      void runMutation(() => deleteAccount(drawer.accountId)).then((persisted) => {
                        if (persisted) {
                          closeDrawer();
                        }
                      });
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              </div>
            ) : null}

            {drawer.type === "addPosition" ? (
              <div className="section-stack">
                <Field label="Asset type">
                  <Dropdown
                    selectedOptions={[positionFormAssetType]}
                    onOptionSelect={(_, eventData) => {
                      const value = eventData.optionValue as AssetType | undefined;
                      if (value) {
                        setPositionFormAssetType(value);
                      }
                    }}
                    disabled={!canEdit || activity !== "idle"}
                  >
                    {assetTypeOptions.map((option) => (
                      <Option key={option.value} value={option.value}>
                        {option.label}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>

                <Field label="Label">
                  <Input
                    value={positionFormLabel}
                    onChange={(_, eventData) => setPositionFormLabel(eventData.value)}
                    placeholder="e.g., Wallet"
                    disabled={!canEdit || activity !== "idle"}
                  />
                </Field>

                <Field
                  label="Market value (JPY)"
                  validationState={positionFormError ? "error" : "none"}
                  validationMessage={positionFormError ?? undefined}
                >
                  <Input
                    inputMode="numeric"
                    value={positionFormMarketValue}
                    onChange={(_, eventData) =>
                      setPositionFormMarketValue(formatIntegerInput(eventData.value))
                    }
                    disabled={!canEdit || activity !== "idle"}
                  />
                </Field>

                <div className="app-actions">
                  <Button
                    appearance="primary"
                    disabled={
                      !canEdit || !drawer.accountId || activity !== "idle" || !!positionFormError
                    }
                    onClick={() => {
                      submitAddPosition(drawer.accountId);
                    }}
                  >
                    Add position
                  </Button>
                </div>
              </div>
            ) : null}

            {drawer.type === "positionDetails" && selectedPosition ? (
              <div className="section-stack">
                <TabList
                  selectedValue={positionTab}
                  onTabSelect={(_, eventData) => {
                    const nextTab = eventData.value as PositionTab;
                    setPositionTab(nextTab);
                    updateQuery((params) => {
                      if (drawer.type === "positionDetails") {
                        params.set("positionTab", nextTab);
                      }
                    });
                  }}
                >
                  <Tab value="details">Details</Tab>
                  <Tab value="allocations">Allocations</Tab>
                  <Tab value="history">History</Tab>
                </TabList>

                {positionTab === "details" ? (
                  <div className="section-stack">
                    <Field label="Asset type">
                      <Dropdown
                        selectedOptions={[positionDetailsAssetType]}
                        onOptionSelect={(_, eventData) => {
                          const value = eventData.optionValue as AssetType | undefined;
                          if (value) {
                            setPositionDetailsAssetType(value);
                          }
                        }}
                        disabled={!canEdit || activity !== "idle"}
                      >
                        {assetTypeOptions.map((option) => (
                          <Option key={option.value} value={option.value}>
                            {option.label}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>

                    <Field label="Label">
                      <Input
                        value={positionDetailsLabel}
                        onChange={(_, eventData) => setPositionDetailsLabel(eventData.value)}
                        disabled={!canEdit || activity !== "idle"}
                      />
                    </Field>

                    <Field label="Market value (inline edit only)">
                      <Input
                        value={formatCurrency(selectedPosition.marketValue)}
                        readOnly
                        disabled
                      />
                    </Field>

                    <Field label="Recalc mode">
                      <Dropdown
                        selectedOptions={[positionDetailsAllocationMode]}
                        onOptionSelect={(_, eventData) => {
                          const value = eventData.optionValue as
                            | Position["allocationMode"]
                            | undefined;
                          if (value) {
                            setPositionDetailsAllocationMode(value);
                          }
                        }}
                        disabled={!canEdit || activity !== "idle"}
                      >
                        {allocationModeOptions.map((option) => (
                          <Option key={option.value} value={option.value}>
                            {option.label}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>

                    <div className="app-muted">
                      Last updated: {formatAbsoluteTimestamp(selectedPosition.updatedAt)}
                    </div>

                    <div className="app-actions">
                      <Button
                        appearance="primary"
                        disabled={!canEdit || activity !== "idle"}
                        onClick={() => {
                          void runMutation(() =>
                            updatePosition({
                              positionId: selectedPosition.id,
                              assetType: positionDetailsAssetType,
                              label: positionDetailsLabel,
                              marketValue: selectedPosition.marketValue,
                              allocationMode: positionDetailsAllocationMode,
                            }),
                          ).then((persisted) => {
                            if (persisted) {
                              finalizeCloseDrawer();
                            }
                          });
                        }}
                      >
                        Save position
                      </Button>
                      <Button
                        disabled={!canEdit || activity !== "idle"}
                        onClick={() => {
                          void runMutation(() => deletePosition(selectedPosition.id)).then(
                            (persisted) => {
                              if (persisted) {
                                finalizeCloseDrawer();
                              }
                            },
                          );
                        }}
                      >
                        Delete position
                      </Button>
                    </div>
                  </div>
                ) : null}

                {positionTab === "allocations" ? (
                  selectedPositionAllocations.length > 0 ? (
                    <div className="section-stack">
                      {selectedPositionAllocations.map((allocation) => (
                        <div key={allocation.id} className="accounts-allocation-row">
                          <div>{allocation.goalName}</div>
                          <div>{formatCurrency(allocation.allocatedAmount)}</div>
                        </div>
                      ))}
                      <div className="app-muted">
                        Allocation editing is available on the Goals page.
                      </div>
                    </div>
                  ) : (
                    <div className="app-muted">
                      No allocations yet. Set goals to start allocating.
                    </div>
                  )
                ) : null}

                {positionTab === "history" ? (
                  <div className="section-stack">
                    <div className="app-muted">Source: OneDrive event log.</div>

                    {historyError ? (
                      <div className="app-alert app-alert-error">{historyError}</div>
                    ) : null}

                    {historyLoading && historyItems.length === 0 ? (
                      <div className="app-muted">Loading history from OneDrive...</div>
                    ) : null}

                    {historyItems.length === 0 && !historyLoading ? (
                      <div className="app-muted">
                        {historyCursor
                          ? "No matching entries in recent chunks. Use Load more to continue."
                          : "No history entries for this position yet."}
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
                              <span className="app-muted">
                                {formatAbsoluteTimestamp(item.timestamp)}
                              </span>
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
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {discardDialogOpen ? (
        <div className="accounts-drawer-overlay" onClick={() => setDiscardDialogOpen(false)}>
          <section
            className="accounts-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Discard changes?</h3>
            <p>You have pending edits in this position.</p>
            <div className="app-actions">
              <Button
                appearance="primary"
                onClick={() => {
                  setDiscardDialogOpen(false);
                  pendingCloseActionRef.current = null;
                  finalizeCloseDrawer();
                }}
              >
                Discard changes and go back
              </Button>
              <Button
                onClick={() => {
                  setDiscardDialogOpen(false);
                  pendingCloseActionRef.current = null;
                }}
              >
                Stay
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {conflictDialogOpen ? (
        <div className="accounts-drawer-overlay" onClick={() => setConflictDialogOpen(false)}>
          <section
            className="accounts-dialog"
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
