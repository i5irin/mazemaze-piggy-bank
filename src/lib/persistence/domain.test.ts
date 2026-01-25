import {
  createAllocation,
  deleteAccount,
  deleteGoal,
  deletePosition,
  recalculateAllocations,
  updatePosition,
} from "./domain";
import type { NormalizedState } from "./types";

const meta = { eventId: "evt-1", createdAt: "2025-01-01T00:00:00Z" };

const createState = (): NormalizedState => ({
  accounts: [
    { id: "acc-1", scope: "personal", name: "Main" },
    { id: "acc-2", scope: "personal", name: "Backup" },
  ],
  positions: [
    {
      id: "pos-1",
      accountId: "acc-1",
      assetType: "cash",
      label: "Wallet",
      marketValue: 100,
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "pos-2",
      accountId: "acc-1",
      assetType: "deposit",
      label: "Bank",
      marketValue: 200,
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ],
  goals: [
    {
      id: "goal-1",
      scope: "personal",
      name: "Emergency",
      targetAmount: 1000,
      priority: 1,
      status: "active",
    },
    {
      id: "goal-2",
      scope: "personal",
      name: "Trip",
      targetAmount: 500,
      priority: 2,
      status: "active",
    },
  ],
  allocations: [
    { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 60 },
    { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 40 },
    { id: "alloc-3", goalId: "goal-1", positionId: "pos-2", allocatedAmount: 50 },
  ],
});

describe("recalculateAllocations", () => {
  it("distributes remainder to the largest original allocation", () => {
    const allocations = [
      { id: "a", goalId: "g1", positionId: "p1", allocatedAmount: 60 },
      { id: "b", goalId: "g2", positionId: "p1", allocatedAmount: 40 },
    ];
    const result = recalculateAllocations(allocations, 100, 101);
    const byId = new Map(result.map((allocation) => [allocation.id, allocation.allocatedAmount]));
    expect(byId.get("a")).toBe(61);
    expect(byId.get("b")).toBe(40);
  });

  it("uses id order as the deterministic tie-breaker", () => {
    const allocations = [
      { id: "alloc-a", goalId: "g1", positionId: "p1", allocatedAmount: 50 },
      { id: "alloc-b", goalId: "g2", positionId: "p1", allocatedAmount: 50 },
    ];
    const result = recalculateAllocations(allocations, 100, 101);
    const byId = new Map(result.map((allocation) => [allocation.id, allocation.allocatedAmount]));
    expect(byId.get("alloc-a")).toBe(51);
    expect(byId.get("alloc-b")).toBe(50);
  });

  it("skips recalculation when the old value is zero", () => {
    const allocations = [{ id: "alloc-a", goalId: "g1", positionId: "p1", allocatedAmount: 0 }];
    const result = recalculateAllocations(allocations, 0, 100);
    expect(result[0].allocatedAmount).toBe(0);
  });
});

describe("allocation constraints", () => {
  it("blocks allocations that exceed the position market value", () => {
    const state = createState();
    const result = createAllocation(
      state,
      { id: "alloc-4", goalId: "goal-2", positionId: "pos-2", allocatedAmount: 200 },
      meta,
    );
    expect("error" in result).toBe(true);
  });
});

describe("deletion cascades", () => {
  it("removes allocations when a position is deleted", () => {
    const state = createState();
    const result = deletePosition(state, "pos-1", meta);
    if ("error" in result) {
      throw new Error("Expected success");
    }
    expect(result.nextState.positions).toHaveLength(1);
    expect(
      result.nextState.allocations.every((allocation) => allocation.positionId !== "pos-1"),
    ).toBe(true);
  });

  it("removes positions and allocations when an account is deleted", () => {
    const state = createState();
    const result = deleteAccount(state, "acc-1", meta);
    if ("error" in result) {
      throw new Error("Expected success");
    }
    expect(result.nextState.accounts).toHaveLength(1);
    expect(result.nextState.positions.every((position) => position.accountId !== "acc-1")).toBe(
      true,
    );
    expect(
      result.nextState.allocations.every((allocation) => allocation.positionId !== "pos-1"),
    ).toBe(true);
  });

  it("removes allocations when a goal is deleted", () => {
    const state = createState();
    const result = deleteGoal(state, "goal-1", meta);
    if ("error" in result) {
      throw new Error("Expected success");
    }
    expect(result.nextState.goals.some((goal) => goal.id === "goal-1")).toBe(false);
    expect(result.nextState.allocations.every((allocation) => allocation.goalId !== "goal-1")).toBe(
      true,
    );
  });
});

describe("position updates", () => {
  it("recalculates allocations when market value changes", () => {
    const state = createState();
    const result = updatePosition(
      state,
      { id: "pos-1", assetType: "cash", label: "Wallet", marketValue: 101 },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation = result.nextState.allocations.find((item) => item.id === "alloc-1");
    expect(allocation?.allocatedAmount).toBe(61);
  });
});
