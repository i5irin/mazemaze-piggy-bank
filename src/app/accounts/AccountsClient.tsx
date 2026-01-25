"use client";

import { Button, Dropdown, Field, Input, Option, Text } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import { usePersonalData } from "@/components/PersonalDataProvider";
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

const formatCurrency = (value: number): string => `¥${value.toLocaleString("en-US")}`;

const parseAmount = (value: string): number | null => {
  if (value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
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
  onUpdate: (input: { label: string; assetType: AssetType; marketValue: string }) => void;
  onDelete: () => void;
}) => {
  const [editPositionLabel, setEditPositionLabel] = useState(position.label);
  const [editPositionAssetType, setEditPositionAssetType] = useState<AssetType>(position.assetType);
  const [editPositionMarketValue, setEditPositionMarketValue] = useState(
    position.marketValue.toString(),
  );
  const [positionDeleteStep, setPositionDeleteStep] = useState<0 | 1 | 2>(0);

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
      <Field label="Market value (JPY)">
        <Input
          type="number"
          inputMode="numeric"
          value={editPositionMarketValue}
          onChange={(_, data) => setEditPositionMarketValue(data.value)}
          disabled={!canEdit}
        />
      </Field>
      <div className="app-muted">
        Updating the market value triggers proportional allocation recalculation.
      </div>
      <div className="app-actions">
        <Button
          onClick={() =>
            onUpdate({
              label: editPositionLabel,
              assetType: editPositionAssetType,
              marketValue: editPositionMarketValue,
            })
          }
          disabled={!canEdit}
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

export default function AccountsClient() {
  const {
    draftState,
    isOnline,
    isSignedIn,
    createAccount,
    updateAccount,
    deleteAccount,
    createPosition,
    updatePosition,
    deletePosition,
  } = usePersonalData();

  const canEdit = isOnline && isSignedIn;
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

  const accountsSorted = useMemo(
    () =>
      [...accounts].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
    [accounts],
  );

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  const effectiveAccountId = useMemo(() => {
    if (selectedAccountId && accountsSorted.some((account) => account.id === selectedAccountId)) {
      return selectedAccountId;
    }
    return accountsSorted[0]?.id ?? null;
  }, [accountsSorted, selectedAccountId]);

  const selectedAccount = accounts.find((account) => account.id === effectiveAccountId) ?? null;

  const positionsForAccount = useMemo(() => {
    if (!selectedAccount) {
      return [];
    }
    return positions
      .filter((position) => position.accountId === selectedAccount.id)
      .sort(
        (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
      );
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

  const selectedPositionAllocations = useMemo(() => {
    if (!selectedPosition) {
      return [];
    }
    return allocations
      .filter((allocation) => allocation.positionId === selectedPosition.id)
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [allocations, selectedPosition]);

  const handleCreateAccount = () => {
    const result = createAccount(newAccountName);
    if (reportOutcome(result, "Account created in draft.")) {
      setNewAccountName("");
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
    const parsed = parseAmount(newPositionMarketValue);
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
    }
  };

  const handleUpdatePosition = (input: {
    label: string;
    assetType: AssetType;
    marketValue: string;
  }) => {
    if (!selectedPosition) {
      setPageError("Select a position to edit.");
      return;
    }
    const parsed = parseAmount(input.marketValue);
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
    return accountsSorted.map((account) => {
      const positionsForCard = positions.filter((position) => position.accountId === account.id);
      const total = positionsForCard.reduce((sum, position) => sum + position.marketValue, 0);
      return {
        account,
        positionsCount: positionsForCard.length,
        total,
      };
    });
  }, [accountsSorted, positions]);

  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Accounts</h1>
        <p className="app-muted">Track personal accounts and positions.</p>
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
        <h2>Account list</h2>
        {accountCardTotals.length === 0 ? (
          <div className="app-muted">No accounts yet. Create one to get started.</div>
        ) : (
          <div className="card-grid">
            {accountCardTotals.map(({ account, positionsCount, total }) => (
              <div key={account.id} className="app-surface">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{account.name}</div>
                    <div className="app-muted">{positionsCount} positions</div>
                  </div>
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
                <div style={{ marginTop: 8, fontSize: "18px", fontWeight: 600 }}>
                  {formatCurrency(total)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="app-surface">
        <h2>Create account</h2>
        <div className="section-stack">
          <Field label="Account name">
            <Input
              value={newAccountName}
              onChange={(_, data) => setNewAccountName(data.value)}
              placeholder="Everyday Cash"
              disabled={!canEdit}
            />
          </Field>
          <Button appearance="primary" onClick={handleCreateAccount} disabled={!canEdit}>
            Add account
          </Button>
        </div>
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
        <h2>Positions</h2>
        {!selectedAccount ? (
          <div className="app-muted">Select an account to manage positions.</div>
        ) : positionsForAccount.length === 0 ? (
          <div className="app-muted">No positions yet for this account.</div>
        ) : (
          <div className="card-grid">
            {positionsForAccount.map((position) => {
              const allocated = allocationTotals[position.id] ?? 0;
              const available = Math.max(0, position.marketValue - allocated);
              return (
                <div key={position.id} className="app-surface">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{position.label}</div>
                      <div className="app-muted">{position.assetType.toUpperCase()}</div>
                    </div>
                    <Button
                      size="small"
                      onClick={() => setSelectedPositionId(position.id)}
                      appearance={effectivePositionId === position.id ? "primary" : "secondary"}
                    >
                      View
                    </Button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600 }}>{formatCurrency(position.marketValue)}</div>
                    <div className="app-muted">
                      Allocated {formatCurrency(allocated)} · Available {formatCurrency(available)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="app-surface">
        <h2>Add position</h2>
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
          <Field label="Market value (JPY)">
            <Input
              type="number"
              inputMode="numeric"
              value={newPositionMarketValue}
              onChange={(_, data) => setNewPositionMarketValue(data.value)}
              disabled={!canEdit || !selectedAccount}
            />
          </Field>
          <Button
            appearance="primary"
            onClick={handleCreatePosition}
            disabled={!canEdit || !selectedAccount}
          >
            Add position
          </Button>
        </div>
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
  );
}
