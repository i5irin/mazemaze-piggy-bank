export type Scope = "personal" | "shared";

export type Account = {
  id: string;
  scope: Scope;
  name: string;
};

export type AssetType =
  | "cash"
  | "deposit"
  | "fx"
  | "securities"
  | "crypto"
  | "payout"
  | "stored"
  | "other";

export type Position = {
  id: string;
  accountId: string;
  assetType: AssetType;
  label: string;
  marketValue: number;
  allocationMode: "fixed" | "ratio" | "priority";
  updatedAt: string;
};

export type Goal = {
  id: string;
  scope: Scope;
  name: string;
  targetAmount: number;
  startDate?: string;
  endDate?: string;
  priority: number;
  status: "active" | "closed";
  closedAt?: string;
  spentAt?: string;
};

export type Allocation = {
  id: string;
  goalId: string;
  positionId: string;
  allocatedAmount: number;
};

export type NormalizedState = {
  accounts: Account[];
  positions: Position[];
  goals: Goal[];
  allocations: Allocation[];
};
