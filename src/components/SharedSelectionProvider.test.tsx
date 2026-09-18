import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { SharedSelectionProvider, useSharedSelection } from "./SharedSelectionProvider";

let mockAccount = "account-a";
let mockStatus = "signed_in";
jest.mock("./AuthProvider", () => ({
  useAuth: () => ({
    providers: {
      onedrive: { account: { id: mockAccount }, status: mockStatus },
    },
  }),
}));
jest.mock("./StorageProviderContext", () => ({
  useStorageProviderContext: () => ({ activeProviderId: "onedrive" }),
}));
const wrapper = ({ children }: { children: ReactNode }) => (
  <SharedSelectionProvider>{children}</SharedSelectionProvider>
);
const selection = {
  providerId: "onedrive" as const,
  sharedId: "owner_root",
  driveId: "owner",
  itemId: "root",
  name: "Family",
};

beforeEach(() => {
  localStorage.clear();
  mockAccount = "account-a";
  mockStatus = "signed_in";
});

it("restores per-account selection after switching away and back", () => {
  const { result, rerender } = renderHook(() => useSharedSelection(), { wrapper });
  act(() => result.current.setSelection(selection));
  mockAccount = "account-b";
  rerender();
  expect(result.current.selection).toBeNull();
  mockAccount = "account-a";
  rerender();
  expect(result.current.selection).toEqual(selection);
  mockStatus = "signed_out";
  rerender();
  expect(result.current.selection).toBeNull();
});

it("does not assign a legacy unscoped OneDrive selection to a new account", () => {
  localStorage.setItem(
    "mazemaze-piggy-bank-shared-selection",
    JSON.stringify({ onedrive: selection }),
  );
  const { result } = renderHook(() => useSharedSelection(), { wrapper });
  expect(result.current.selection).toBeNull();
});
