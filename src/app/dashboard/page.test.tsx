import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";

jest.mock("@/components/PersonalDataProvider", () => ({
  usePersonalData: () => ({
    status: "ready",
    activity: "idle",
    source: "empty",
    snapshot: null,
    draftState: null,
    isOnline: true,
    isSignedIn: true,
    isDirty: false,
    canWrite: true,
    readOnlyReason: null,
    space: { scope: "personal", label: "Personal" },
    lease: null,
    leaseError: null,
    message: null,
    error: null,
    allocationNotice: null,
    latestEvent: null,
    loadHistoryPage: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    refresh: jest.fn(),
    createAccount: jest.fn(),
    updateAccount: jest.fn(),
    deleteAccount: jest.fn(),
    createPosition: jest.fn(),
    updatePosition: jest.fn(),
    deletePosition: jest.fn(),
    createGoal: jest.fn(),
    updateGoal: jest.fn(),
    deleteGoal: jest.fn(),
    createAllocation: jest.fn(),
    updateAllocation: jest.fn(),
    deleteAllocation: jest.fn(),
    reduceAllocations: jest.fn(),
    spendGoal: jest.fn(),
    undoSpend: jest.fn(),
    clearAllocationNotice: jest.fn(),
    saveChanges: jest.fn(),
    discardChanges: jest.fn(),
  }),
}));

describe("DashboardPage", () => {
  it("renders the dashboard heading", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <DashboardPage />
      </FluentProvider>,
    );
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});
