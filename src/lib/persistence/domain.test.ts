import {
  createAllocation,
  deleteAccount,
  deleteGoal,
  deletePosition,
  recalculateAllocations,
  spendGoal,
  undoSpend,
  updateAllocation,
  updateGoal,
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
      allocationMode: "fixed",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "pos-2",
      accountId: "acc-1",
      assetType: "deposit",
      label: "Bank",
      marketValue: 200,
      allocationMode: "fixed",
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

  it("uses goal order as the deterministic tie-breaker", () => {
    const allocations = [
      { id: "alloc-a", goalId: "goal-b", positionId: "p1", allocatedAmount: 50 },
      { id: "alloc-b", goalId: "goal-a", positionId: "p1", allocatedAmount: 50 },
    ];
    const result = recalculateAllocations(allocations, 100, 101);
    const byId = new Map(result.map((allocation) => [allocation.id, allocation.allocatedAmount]));
    expect(byId.get("alloc-b")).toBe(51);
    expect(byId.get("alloc-a")).toBe(50);
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

  it("blocks allocations that exceed the goal target amount", () => {
    const state = createState();
    const result = createAllocation(
      state,
      { id: "alloc-4", goalId: "goal-2", positionId: "pos-2", allocatedAmount: 500 },
      meta,
    );
    expect("error" in result).toBe(true);
  });

  it("blocks allocation updates that exceed the goal target amount", () => {
    const state = createState();
    const result = updateAllocation(state, { id: "alloc-2", allocatedAmount: 600 }, meta);
    expect("error" in result).toBe(true);
  });

  it("reduces allocations proportionally when the goal target is lowered", () => {
    const state = createState();
    const result = updateGoal(
      state,
      {
        id: "goal-1",
        name: "Emergency",
        targetAmount: 10,
        priority: 1,
        status: "active",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocations = result.nextState.allocations.filter(
      (allocation) => allocation.goalId === "goal-1",
    );
    const byPosition = new Map(
      allocations.map((allocation) => [allocation.positionId, allocation.allocatedAmount]),
    );
    expect(byPosition.get("pos-1")).toBe(6);
    expect(byPosition.get("pos-2")).toBe(4);
  });
});

describe("allocation upsert and cleanup", () => {
  it("upserts allocations by goal and position", () => {
    const state = createState();
    const result = createAllocation(
      state,
      { id: "alloc-new", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 10 },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    expect(result.nextState.allocations).toHaveLength(3);
    const updated = result.nextState.allocations.find((item) => item.id === "alloc-2");
    expect(updated?.allocatedAmount).toBe(10);
  });

  it("deletes allocations when updated to zero", () => {
    const state = createState();
    const result = updateAllocation(state, { id: "alloc-2", allocatedAmount: 0 }, meta);
    if ("error" in result) {
      throw new Error("Expected success");
    }
    expect(result.nextState.allocations.some((item) => item.id === "alloc-2")).toBe(false);
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
  it("keeps allocations fixed unless exceeding the new market value", () => {
    const state = createState();
    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 101,
        allocationMode: "fixed",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation = result.nextState.allocations.find((item) => item.id === "alloc-1");
    expect(allocation?.allocatedAmount).toBe(60);
  });

  it("reduces fixed allocations from low priority goals first", () => {
    const state = createState();
    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 50,
        allocationMode: "fixed",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocations = result.nextState.allocations.filter(
      (allocation) => allocation.positionId === "pos-1",
    );
    const byId = new Map(
      allocations.map((allocation) => [allocation.id, allocation.allocatedAmount]),
    );
    expect(byId.has("alloc-2")).toBe(false);
    expect(byId.get("alloc-1")).toBe(50);
  });

  it("recalculates ratio allocations and clamps to goal remaining", () => {
    const state = {
      ...createState(),
      positions: [
        { ...createState().positions[0], allocationMode: "ratio" },
        { ...createState().positions[1], allocationMode: "fixed" },
      ],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 60 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 40 },
        { id: "alloc-3", goalId: "goal-1", positionId: "pos-2", allocatedAmount: 980 },
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
    } satisfies NormalizedState;

    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 120,
        allocationMode: "ratio",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation = result.nextState.allocations.find((item) => item.id === "alloc-1");
    const allocation2 = result.nextState.allocations.find((item) => item.id === "alloc-2");
    expect(allocation?.allocatedAmount).toBe(20);
    expect(allocation2?.allocatedAmount).toBe(48);
  });

  it("keeps unallocated in ratio calculations", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [
        { ...createState().positions[0], marketValue: 100000, allocationMode: "ratio" },
        ...createState().positions.slice(1),
      ],
      goals: [
        {
          id: "goal-1",
          scope: "personal",
          name: "Emergency",
          targetAmount: 300000,
          priority: 1,
          status: "active",
        },
        {
          id: "goal-2",
          scope: "personal",
          name: "Trip",
          targetAmount: 300000,
          priority: 2,
          status: "active",
        },
      ],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 10000 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 80000 },
      ],
    };

    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 200000,
        allocationMode: "ratio",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation1 = result.nextState.allocations.find((item) => item.id === "alloc-1");
    const allocation2 = result.nextState.allocations.find((item) => item.id === "alloc-2");
    expect(allocation1?.allocatedAmount).toBe(20000);
    expect(allocation2?.allocatedAmount).toBe(160000);
  });

  it("does not auto-increase closed goal allocations in ratio mode", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [{ ...createState().positions[0], allocationMode: "ratio" }],
      goals: [
        {
          id: "goal-1",
          scope: "personal",
          name: "Closed",
          targetAmount: 1000,
          priority: 1,
          status: "closed",
        },
        {
          id: "goal-2",
          scope: "personal",
          name: "Active",
          targetAmount: 1000,
          priority: 2,
          status: "active",
        },
      ],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 50 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 50 },
      ],
    };

    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 200,
        allocationMode: "ratio",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation1 = result.nextState.allocations.find((item) => item.id === "alloc-1");
    const allocation2 = result.nextState.allocations.find((item) => item.id === "alloc-2");
    expect(allocation1?.allocatedAmount).toBe(50);
    expect(allocation2?.allocatedAmount).toBe(150);
  });

  it("repairs ratio allocations when the old value is zero", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [{ ...createState().positions[0], marketValue: 0, allocationMode: "ratio" }],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 60 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 40 },
      ],
    };
    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 50,
        allocationMode: "ratio",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation1 = result.nextState.allocations.find((item) => item.id === "alloc-1");
    const allocation2 = result.nextState.allocations.find((item) => item.id === "alloc-2");
    expect(allocation1?.allocatedAmount).toBe(50);
    expect(allocation2).toBeUndefined();
  });

  it("keeps priority allocations when no reduction is required", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [
        { ...createState().positions[0], allocationMode: "priority" },
        { ...createState().positions[1], allocationMode: "fixed" },
      ],
      goals: [
        {
          id: "goal-1",
          scope: "personal",
          name: "Emergency",
          targetAmount: 100,
          priority: 1,
          status: "active",
        },
        {
          id: "goal-2",
          scope: "personal",
          name: "Trip",
          targetAmount: 100,
          priority: 1,
          status: "active",
        },
      ],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 10 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 10 },
        { id: "alloc-3", goalId: "goal-1", positionId: "pos-2", allocatedAmount: 90 },
      ],
    };

    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 50,
        allocationMode: "priority",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocations = result.nextState.allocations.filter(
      (allocation) => allocation.positionId === "pos-1",
    );
    const byId = new Map(
      allocations.map((allocation) => [allocation.id, allocation.allocatedAmount]),
    );
    expect(byId.get("alloc-1")).toBe(10);
    expect(byId.get("alloc-2")).toBe(10);
  });

  it("allocates priority increases to active goals in order", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [
        { ...createState().positions[0], allocationMode: "priority" },
        ...createState().positions.slice(1),
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
          targetAmount: 1000,
          priority: 2,
          status: "active",
        },
      ],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 10 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 10 },
      ],
    };

    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 150,
        allocationMode: "priority",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocations = result.nextState.allocations.filter(
      (allocation) => allocation.positionId === "pos-1",
    );
    const byId = new Map(
      allocations.map((allocation) => [allocation.id, allocation.allocatedAmount]),
    );
    expect(byId.get("alloc-1")).toBe(60);
    expect(byId.get("alloc-2")).toBe(10);
  });

  it("reduces closed goals by closedAt order after active allocations are exhausted", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [{ ...createState().positions[0], allocationMode: "fixed" }],
      goals: [
        {
          id: "goal-active",
          scope: "personal",
          name: "Active",
          targetAmount: 1000,
          priority: 1,
          status: "active",
        },
        {
          id: "goal-closed-new",
          scope: "personal",
          name: "Closed New",
          targetAmount: 1000,
          priority: 2,
          status: "closed",
          closedAt: "2025-01-02T00:00:00Z",
        },
        {
          id: "goal-closed-old",
          scope: "personal",
          name: "Closed Old",
          targetAmount: 1000,
          priority: 3,
          status: "closed",
          closedAt: "2024-12-31T00:00:00Z",
        },
      ],
      allocations: [
        {
          id: "alloc-active",
          goalId: "goal-active",
          positionId: "pos-1",
          allocatedAmount: 30,
        },
        {
          id: "alloc-closed-new",
          goalId: "goal-closed-new",
          positionId: "pos-1",
          allocatedAmount: 30,
        },
        {
          id: "alloc-closed-old",
          goalId: "goal-closed-old",
          positionId: "pos-1",
          allocatedAmount: 40,
        },
      ],
    };

    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 20,
        allocationMode: "fixed",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const byId = new Map(
      result.nextState.allocations.map((allocation) => [allocation.id, allocation.allocatedAmount]),
    );
    expect(byId.get("alloc-active")).toBeUndefined();
    expect(byId.get("alloc-closed-new")).toBeUndefined();
    expect(byId.get("alloc-closed-old")).toBe(20);
  });

  it("skips ratio recalculation when old value is zero", () => {
    const state: NormalizedState = {
      ...createState(),
      positions: [
        { ...createState().positions[0], marketValue: 0, allocationMode: "ratio" },
        ...createState().positions.slice(1),
      ],
      allocations: [
        { id: "alloc-1", goalId: "goal-1", positionId: "pos-1", allocatedAmount: 0 },
        { id: "alloc-2", goalId: "goal-2", positionId: "pos-1", allocatedAmount: 0 },
      ],
    };
    const result = updatePosition(
      state,
      {
        id: "pos-1",
        assetType: "cash",
        label: "Wallet",
        marketValue: 100,
        allocationMode: "ratio",
      },
      meta,
    );
    if ("error" in result) {
      throw new Error("Expected success");
    }
    const allocation = result.nextState.allocations.find((item) => item.id === "alloc-1");
    expect(allocation).toBeUndefined();
  });
});

describe("spend and undo", () => {
  it("marks a closed goal as spent and can undo", () => {
    const state: NormalizedState = {
      ...createState(),
      goals: [
        {
          id: "goal-1",
          scope: "personal",
          name: "Emergency",
          targetAmount: 1000,
          priority: 1,
          status: "closed",
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
    };

    const spendResult = spendGoal(
      state,
      {
        goalId: "goal-1",
        payments: [
          { positionId: "pos-1", amount: 60 },
          { positionId: "pos-2", amount: 50 },
        ],
      },
      meta,
    );
    if ("error" in spendResult) {
      throw new Error("Expected success");
    }
    const spentGoal = spendResult.nextState.goals.find((goal) => goal.id === "goal-1");
    expect(spentGoal?.spentAt).toBe(meta.createdAt);
    expect(
      spendResult.nextState.allocations.some((allocation) => allocation.goalId === "goal-1"),
    ).toBe(false);
    const pos1 = spendResult.nextState.positions.find((position) => position.id === "pos-1");
    const pos2 = spendResult.nextState.positions.find((position) => position.id === "pos-2");
    expect(pos1?.marketValue).toBe(40);
    expect(pos2?.marketValue).toBe(150);

    const payload = spendResult.events[0].payload;
    const undoResult = undoSpend(
      spendResult.nextState,
      { payload },
      { eventId: "evt-undo", createdAt: "2025-01-01T01:00:00Z" },
    );
    if ("error" in undoResult) {
      throw new Error("Expected success");
    }
    const restoredGoal = undoResult.nextState.goals.find((goal) => goal.id === "goal-1");
    expect(restoredGoal?.spentAt).toBeUndefined();
    const restoredPos1 = undoResult.nextState.positions.find((position) => position.id === "pos-1");
    const restoredPos2 = undoResult.nextState.positions.find((position) => position.id === "pos-2");
    expect(restoredPos1?.marketValue).toBe(100);
    expect(restoredPos2?.marketValue).toBe(200);
    expect(
      undoResult.nextState.allocations.filter((allocation) => allocation.goalId === "goal-1"),
    ).toHaveLength(2);
  });
});
