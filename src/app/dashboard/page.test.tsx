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
    refresh: jest.fn(),
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
