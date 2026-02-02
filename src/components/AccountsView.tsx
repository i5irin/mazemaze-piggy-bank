"use client";

import { Button, Dropdown, Field, Input, Option, Text } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import type { DataContextValue } from "@/components/dataContext";
import {
  formatCurrency,
  formatIntegerInput,
  getIntegerInputError,
  parseIntegerInput,
} from "@/lib/numberFormat";
import type { Account, AssetType, Position } from "@/lib/persistence/types";

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

const formatTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("en-US");
};

const AccountDetailsPanel = ({
  account,
  canEdit,
  onUpdate,
  onDelete,
}: {
  account: Account;
  canEdit: boolean;
  onUpdate: (name: string) => void;
  onDelete: () => void;
}) => {
  const [editAccountName, setEditAccountName] = useState(account.name);
  const [accountDeleteStep, setAccountDeleteStep] = useState<0 | 1 | 2>(0);

  return (
    <div className="section-stack">
      <div>
        <div className="app-muted">Selected account</div>
        <div style={{ fontWeight: 600 }}>{account.name}</div>
      </div>
      <Field label="Account name">
        <Input
          value={editAccountName}
          onChange={(_, data) => setEditAccountName(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <div className="app-actions">
        <Button onClick={() => onUpdate(editAccountName)} disabled={!canEdit}>
          Save account
        </Button>
        {accountDeleteStep === 0 ? (
          <Button onClick={() => setAccountDeleteStep(1)} disabled={!canEdit}>
            Delete account
          </Button>
        ) : null}
      </div>
      {accountDeleteStep >= 1 ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>
            This removes the account, all positions, and all related allocations. This action cannot
            be undone.
          </Text>
          <div className="app-actions" style={{ marginTop: 12 }}>
            {accountDeleteStep === 1 ? (
              <>
                <Button appearance="primary" onClick={() => setAccountDeleteStep(2)}>
                  Continue
                </Button>
                <Button onClick={() => setAccountDeleteStep(0)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button appearance="primary" onClick={onDelete} disabled={!canEdit}>
                  Delete permanently
                </Button>
                <Button onClick={() => setAccountDeleteStep(0)}>Cancel</Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const PositionDetailsPanel = ({
  position,
  canEdit,
  onUpdate,
  onDelete,
}: {
  position: Position;
  canEdit: boolean;
  onUpdate: (input: {
    label: string;
    assetType: AssetType;
    marketValue: string;
    allocationMode: Position["allocationMode"];
  }) => void;
  onDelete: () => void;
}) => {
  const [editPositionLabel, setEditPositionLabel] = useState(position.label);
  const [editPositionAssetType, setEditPositionAssetType] = useState<AssetType>(position.assetType);
  const [editPositionMarketValue, setEditPositionMarketValue] = useState(
    formatIntegerInput(position.marketValue.toString()),
  );
  const [editPositionAllocationMode, setEditPositionAllocationMode] = useState<
    Position["allocationMode"]
  >(position.allocationMode);
  const [positionDeleteStep, setPositionDeleteStep] = useState<0 | 1 | 2>(0);
  const marketValueError = getIntegerInputError(editPositionMarketValue, { required: true });

  return (
    <div className="section-stack">
      <div>
        <div className="app-muted">Selected position</div>
        <div style={{ fontWeight: 600 }}>{position.label}</div>
      </div>
      <Field label="Asset type">
        <Dropdown
          selectedOptions={[editPositionAssetType]}
          onOptionSelect={(_, data) => {
            const value = data.optionValue as AssetType | undefined;
            if (value) {
              setEditPositionAssetType(value);
            }
          }}
          disabled={!canEdit}
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
          value={editPositionLabel}
          onChange={(_, data) => setEditPositionLabel(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <Field
        label="Market value (JPY)"
        validationState={marketValueError ? "error" : "none"}
        validationMessage={marketValueError ?? undefined}
      >
        <Input
          inputMode="numeric"
          value={editPositionMarketValue}
          onChange={(_, data) => setEditPositionMarketValue(formatIntegerInput(data.value))}
          disabled={!canEdit}
        />
      </Field>
      <Field label="Allocation mode">
        <Dropdown
          selectedOptions={[editPositionAllocationMode]}
          onOptionSelect={(_, data) => {
            const value = data.optionValue as Position["allocationMode"] | undefined;
            if (value) {
              setEditPositionAllocationMode(value);
            }
          }}
          disabled={!canEdit}
        >
          {allocationModeOptions.map((option) => (
            <Option key={option.value} value={option.value}>
              {option.label}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <div className="app-muted">
        Updating the market value triggers allocation recalculation based on the selected mode.
      </div>
      <div className="app-actions">
        <Button
          onClick={() =>
            onUpdate({
              label: editPositionLabel,
              assetType: editPositionAssetType,
              marketValue: editPositionMarketValue,
              allocationMode: editPositionAllocationMode,
            })
          }
          disabled={!canEdit || !!marketValueError}
        >
          Save position
        </Button>
        {positionDeleteStep === 0 ? (
          <Button onClick={() => setPositionDeleteStep(1)} disabled={!canEdit}>
            Delete position
          </Button>
        ) : null}
      </div>
      {positionDeleteStep >= 1 ? (
        <div className="app-alert app-alert-error" role="alert">
          <Text>This removes the position and all related allocations. This cannot be undone.</Text>
          <div className="app-actions" style={{ marginTop: 12 }}>
            {positionDeleteStep === 1 ? (
              <>
                <Button appearance="primary" onClick={() => setPositionDeleteStep(2)}>
                  Continue
                </Button>
                <Button onClick={() => setPositionDeleteStep(0)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button appearance="primary" onClick={onDelete} disabled={!canEdit}>
                  Delete permanently
                </Button>
                <Button onClick={() => setPositionDeleteStep(0)}>Cancel</Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export function AccountsView({ data }: { data: DataContextValue }) {
  const {
    draftState,
    isOnline,
    isSignedIn,
    canWrite,
    createAccount,
    updateAccount,
    deleteAccount,
    createPosition,
    updatePosition,
    deletePosition,
    space,
  } = data;

  const canEdit = isOnline && isSignedIn && canWrite;
  const editNotice = getEditNotice(data);
  const scopeLabel = space.scope === "shared" ? "Shared" : "Personal";
  const accounts = useMemo(() => draftState?.accounts ?? [], [draftState?.accounts]);
  const positions = useMemo(() => draftState?.positions ?? [], [draftState?.positions]);
  const allocations = useMemo(() => draftState?.allocations ?? [], [draftState?.allocations]);
  const goals = useMemo(() => draftState?.goals ?? [], [draftState?.goals]);

  const allocationTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const allocation of allocations) {
      totals[allocation.positionId] =
        (totals[allocation.positionId] ?? 0) + allocation.allocatedAmount;
    }
    return totals;
  }, [allocations]);

  const goalsById = useMemo(() => {
    const map = new Map(goals.map((goal) => [goal.id, goal]));
    return map;
  }, [goals]);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  const effectiveAccountId = useMemo(() => {
    if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) {
      return selectedAccountId;
    }
    return accounts[0]?.id ?? null;
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts.find((account) => account.id === effectiveAccountId) ?? null;

  const positionsForAccount = useMemo(() => {
    if (!selectedAccount) {
      return [];
    }
    return positions.filter((position) => position.accountId === selectedAccount.id);
  }, [positions, selectedAccount]);

  const effectivePositionId = useMemo(() => {
    if (
      selectedPositionId &&
      positionsForAccount.some((position) => position.id === selectedPositionId)
    ) {
      return selectedPositionId;
    }
    return positionsForAccount[0]?.id ?? null;
  }, [positionsForAccount, selectedPositionId]);

  const selectedPosition =
    positionsForAccount.find((position) => position.id === effectivePositionId) ?? null;

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

  const [newAccountName, setNewAccountName] = useState("");
  const [newPositionLabel, setNewPositionLabel] = useState("");
  const [newPositionAssetType, setNewPositionAssetType] = useState<AssetType>("cash");
  const [newPositionMarketValue, setNewPositionMarketValue] = useState("0");
  const [isAccountDrawerOpen, setIsAccountDrawerOpen] = useState(false);
  const [isPositionDrawerOpen, setIsPositionDrawerOpen] = useState(false);
  const [inlineEditPositionId, setInlineEditPositionId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const [isFabOpen, setIsFabOpen] = useState(false);

  const selectedPositionAllocations = useMemo(() => {
    if (!selectedPosition) {
      return [];
    }
    return allocations
      .filter((allocation) => allocation.positionId === selectedPosition.id)
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [allocations, selectedPosition]);
  const ratioNeedsSetup =
    selectedPosition?.allocationMode === "ratio" && selectedPositionAllocations.length === 0;
  const ratioZeroBalance =
    selectedPosition?.allocationMode === "ratio" && selectedPosition.marketValue === 0;
  const newPositionMarketValueError = getIntegerInputError(newPositionMarketValue, {
    required: true,
  });

  const handleCreateAccount = () => {
    const result = createAccount(newAccountName);
    if (reportOutcome(result, "Account created in draft.")) {
      setNewAccountName("");
      setIsAccountDrawerOpen(false);
    }
  };

  const handleUpdateAccount = (name: string) => {
    if (!selectedAccount) {
      setPageError("Select an account to edit.");
      return;
    }
    reportOutcome(updateAccount(selectedAccount.id, name), "Account updated in draft.");
  };

  const handleDeleteAccount = () => {
    if (!selectedAccount) {
      setPageError("Select an account to delete.");
      return;
    }
    reportOutcome(deleteAccount(selectedAccount.id), "Account deleted in draft.");
  };

  const handleCreatePosition = () => {
    if (!selectedAccount) {
      setPageError("Select an account before adding a position.");
      return;
    }
    const parsed = parseIntegerInput(newPositionMarketValue);
    if (parsed === null) {
      setPageError("Market value must be a non-negative integer.");
      return;
    }
    const result = createPosition({
      accountId: selectedAccount.id,
      assetType: newPositionAssetType,
      label: newPositionLabel,
      marketValue: parsed,
    });
    if (reportOutcome(result, "Position created in draft.")) {
      setNewPositionLabel("");
      setNewPositionMarketValue("0");
      setNewPositionAssetType("cash");
      setIsPositionDrawerOpen(false);
    }
  };

  const handleUpdatePosition = (input: {
    label: string;
    assetType: AssetType;
    marketValue: string;
    allocationMode: Position["allocationMode"];
  }) => {
    if (!selectedPosition) {
      setPageError("Select a position to edit.");
      return;
    }
    const parsed = parseIntegerInput(input.marketValue);
    if (parsed === null) {
      setPageError("Market value must be a non-negative integer.");
      return;
    }
    reportOutcome(
      updatePosition({
        positionId: selectedPosition.id,
        assetType: input.assetType,
        label: input.label,
        marketValue: parsed,
        allocationMode: input.allocationMode,
      }),
      "Position updated in draft.",
    );
  };

  const handleDeletePosition = () => {
    if (!selectedPosition) {
      setPageError("Select a position to delete.");
      return;
    }
    reportOutcome(deletePosition(selectedPosition.id), "Position deleted in draft.");
  };

  const accountCardTotals = useMemo(() => {
    return accounts.map((account) => {
      const positionsForCard = positions.filter((position) => position.accountId === account.id);
      const total = positionsForCard.reduce((sum, position) => sum + position.marketValue, 0);
      return {
        account,
        positionsCount: positionsForCard.length,
        total,
      };
    });
  }, [accounts, positions]);

  const startInlineEdit = (position: Position) => {
    setInlineEditPositionId(position.id);
    setInlineEditValue(formatIntegerInput(position.marketValue.toString()));
  };

  const cancelInlineEdit = () => {
    setInlineEditPositionId(null);
    setInlineEditValue("");
  };

  return (
    <div className="section-stack">
      <section className="app-surface accounts-hero">
        <div className="accounts-hero-row">
          <div>
            <h1>Accounts</h1>
            <p className="app-muted">Track {scopeLabel.toLowerCase()} accounts and positions.</p>
            {space.scope === "shared" ? (
              <div className="app-muted">
                Shared space: {space.label} ({space.sharedId ?? "Unknown"})
              </div>
            ) : null}
          </div>
          <div className="accounts-hero-actions">
            <Button
              appearance="primary"
              onClick={() => setIsAccountDrawerOpen(true)}
              disabled={!canEdit}
            >
              Add account
            </Button>
            <Button
              appearance="secondary"
              onClick={() => setIsPositionDrawerOpen(true)}
              disabled={!canEdit || !selectedAccount}
            >
              Add position
            </Button>
          </div>
        </div>
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

      <div className="accounts-layout">
        <section className="app-surface accounts-list">
          <div className="accounts-list-header">
            <h2>Accounts</h2>
            <Button size="small" onClick={() => setIsAccountDrawerOpen(true)} disabled={!canEdit}>
              Add
            </Button>
          </div>
          {accountCardTotals.length === 0 ? (
            <div className="app-muted">No accounts yet. Create one to get started.</div>
          ) : (
            <div className="section-stack">
              {accountCardTotals.map(({ account, positionsCount, total }) => (
                <div key={account.id} className="accounts-list-item">
                  <div>
                    <div style={{ fontWeight: 600 }}>{account.name}</div>
                    <div className="app-muted">{positionsCount} positions</div>
                  </div>
                  <div className="accounts-list-item-meta">
                    <div style={{ fontWeight: 600 }}>{formatCurrency(total)}</div>
                    <Button
                      size="small"
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        setSelectedPositionId(null);
                      }}
                      appearance={effectiveAccountId === account.id ? "primary" : "secondary"}
                    >
                      View
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="section-stack">
          <section className="app-surface">
            <div className="accounts-section-header">
              <div>
                <h2>Positions</h2>
                {selectedAccount ? (
                  <div className="app-muted">Selected account: {selectedAccount.name}</div>
                ) : null}
              </div>
              <Button
                size="small"
                onClick={() => setIsPositionDrawerOpen(true)}
                disabled={!canEdit || !selectedAccount}
              >
                Add position
              </Button>
            </div>
            {!selectedAccount ? (
              <div className="app-muted">Select an account to manage positions.</div>
            ) : positionsForAccount.length === 0 ? (
              <div className="app-muted">No positions yet for this account.</div>
            ) : (
              <div className="accounts-table">
                <div className="accounts-table-row accounts-table-header">
                  <div>Label</div>
                  <div>Type</div>
                  <div>Value</div>
                  <div>Recalc mode</div>
                  <div>Last updated</div>
                  <div>Actions</div>
                </div>
                {positionsForAccount.map((position) => {
                  const allocated = allocationTotals[position.id] ?? 0;
                  const available = Math.max(0, position.marketValue - allocated);
                  const isInlineEditing = inlineEditPositionId === position.id;
                  const inlineError = isInlineEditing
                    ? getIntegerInputError(inlineEditValue, { required: true })
                    : null;
                  return (
                    <div key={position.id} className="accounts-table-row">
                      <div style={{ fontWeight: 600 }}>{position.label}</div>
                      <div>{assetTypeLabels.get(position.assetType) ?? position.assetType}</div>
                      <div>
                        {isInlineEditing ? (
                          <div className="section-stack" style={{ gap: 4 }}>
                            <Input
                              inputMode="numeric"
                              value={inlineEditValue}
                              onChange={(_, data) =>
                                setInlineEditValue(formatIntegerInput(data.value))
                              }
                              disabled={!canEdit}
                              aria-label={`Edit ${position.label} value`}
                            />
                            {inlineError ? (
                              <div className="app-muted" role="alert">
                                {inlineError}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {formatCurrency(position.marketValue)}
                            </div>
                            <div className="app-muted">
                              Allocated {formatCurrency(allocated)} · Available{" "}
                              {formatCurrency(available)}
                            </div>
                          </div>
                        )}
                      </div>
                      <div>
                        {allocationModeLabels.get(position.allocationMode) ??
                          position.allocationMode}
                      </div>
                      <div>{formatTimestamp(position.updatedAt)}</div>
                      <div className="accounts-table-actions">
                        {isInlineEditing ? (
                          <>
                            <Button
                              size="small"
                              appearance="primary"
                              onClick={() => {
                                const parsed = parseIntegerInput(inlineEditValue);
                                if (parsed === null) {
                                  setPageError("Market value must be a non-negative integer.");
                                  return;
                                }
                                const result = updatePosition({
                                  positionId: position.id,
                                  assetType: position.assetType,
                                  label: position.label,
                                  marketValue: parsed,
                                  allocationMode: position.allocationMode,
                                });
                                if (reportOutcome(result, "Position updated in draft.")) {
                                  cancelInlineEdit();
                                }
                              }}
                              disabled={!canEdit || !!inlineError}
                            >
                              Save
                            </Button>
                            <Button size="small" onClick={cancelInlineEdit}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="small"
                              onClick={() => setSelectedPositionId(position.id)}
                              appearance={
                                effectivePositionId === position.id ? "primary" : "secondary"
                              }
                            >
                              View
                            </Button>
                            <Button
                              size="small"
                              onClick={() => startInlineEdit(position)}
                              disabled={!canEdit}
                            >
                              Edit value
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="app-surface">
            <h2>Account details</h2>
            {!selectedAccount ? (
              <div className="app-muted">Select an account to view details.</div>
            ) : (
              <div className="section-stack">
                <AccountDetailsPanel
                  key={selectedAccount.id}
                  account={selectedAccount}
                  canEdit={canEdit}
                  onUpdate={handleUpdateAccount}
                  onDelete={handleDeleteAccount}
                />
              </div>
            )}
          </section>

          <section className="app-surface">
            <h2>Position details</h2>
            {!selectedPosition ? (
              <div className="app-muted">Select a position to view details.</div>
            ) : (
              <div className="section-stack">
                <PositionDetailsPanel
                  key={selectedPosition.id}
                  position={selectedPosition}
                  canEdit={canEdit}
                  onUpdate={handleUpdatePosition}
                  onDelete={handleDeletePosition}
                />
                {ratioNeedsSetup ? (
                  <div className="app-muted">
                    Ratio mode preserves existing allocation ratios. Create allocations first to
                    define the ratio.
                  </div>
                ) : null}
                {ratioZeroBalance ? (
                  <div className="app-muted">
                    When the balance increases from zero, ratio mode does not auto-allocate. Add
                    allocations manually if needed.
                  </div>
                ) : null}

                <div>
                  <h3>Allocations linked to this position</h3>
                  {selectedPositionAllocations.length === 0 ? (
                    <div className="app-muted">No allocations yet for this position.</div>
                  ) : (
                    <div className="section-stack">
                      {selectedPositionAllocations.map((allocation) => {
                        const goal = goalsById.get(allocation.goalId);
                        return (
                          <div key={allocation.id} className="app-surface">
                            <div style={{ fontWeight: 600 }}>{goal?.name ?? "Unknown goal"}</div>
                            <div className="app-muted">
                              {formatCurrency(allocation.allocatedAmount)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {isAccountDrawerOpen ? (
        <div className="accounts-drawer-overlay" onClick={() => setIsAccountDrawerOpen(false)}>
          <div
            className="accounts-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="accounts-drawer-header">
              <div style={{ fontWeight: 600 }}>Add account</div>
              <Button onClick={() => setIsAccountDrawerOpen(false)}>Close</Button>
            </div>
            <div className="section-stack">
              <Field label="Account name">
                <Input
                  value={newAccountName}
                  onChange={(_, data) => setNewAccountName(data.value)}
                  placeholder="Everyday Cash"
                  disabled={!canEdit}
                />
              </Field>
              <div className="app-actions">
                <Button appearance="primary" onClick={handleCreateAccount} disabled={!canEdit}>
                  Add account
                </Button>
                <Button onClick={() => setIsAccountDrawerOpen(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isPositionDrawerOpen ? (
        <div className="accounts-drawer-overlay" onClick={() => setIsPositionDrawerOpen(false)}>
          <div
            className="accounts-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="accounts-drawer-header">
              <div style={{ fontWeight: 600 }}>Add position</div>
              <Button onClick={() => setIsPositionDrawerOpen(false)}>Close</Button>
            </div>
            <div className="section-stack">
              <Field label="Asset type">
                <Dropdown
                  selectedOptions={[newPositionAssetType]}
                  onOptionSelect={(_, data) => {
                    const value = data.optionValue as AssetType | undefined;
                    if (value) {
                      setNewPositionAssetType(value);
                    }
                  }}
                  disabled={!canEdit || !selectedAccount}
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
                  value={newPositionLabel}
                  onChange={(_, data) => setNewPositionLabel(data.value)}
                  placeholder="e.g., Wallet"
                  disabled={!canEdit || !selectedAccount}
                />
              </Field>
              <Field
                label="Market value (JPY)"
                validationState={newPositionMarketValueError ? "error" : "none"}
                validationMessage={newPositionMarketValueError ?? undefined}
              >
                <Input
                  inputMode="numeric"
                  value={newPositionMarketValue}
                  onChange={(_, data) => setNewPositionMarketValue(formatIntegerInput(data.value))}
                  disabled={!canEdit || !selectedAccount}
                />
              </Field>
              <div className="app-actions">
                <Button
                  appearance="primary"
                  onClick={handleCreatePosition}
                  disabled={!canEdit || !selectedAccount || !!newPositionMarketValueError}
                >
                  Add position
                </Button>
                <Button onClick={() => setIsPositionDrawerOpen(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="accounts-fab">
        <Button
          appearance="primary"
          onClick={() => setIsFabOpen((open) => !open)}
          disabled={!canEdit}
        >
          +
        </Button>
        {isFabOpen ? (
          <div className="accounts-fab-menu">
            <Button onClick={() => setIsAccountDrawerOpen(true)} disabled={!canEdit}>
              Add account
            </Button>
            <Button
              onClick={() => setIsPositionDrawerOpen(true)}
              disabled={!canEdit || !selectedAccount}
            >
              Add position
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
