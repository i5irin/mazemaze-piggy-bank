import { fireEvent, render, screen } from "@testing-library/react";
import { ReauthenticationNotice } from "./ReauthenticationNotice";

const mockSignIn = jest.fn();
const mockAuth = {
  providers: {
    onedrive: {
      status: "signed_out",
      reauthPrompt: null as string | null,
      error: null as string | null,
    },
    gdrive: {
      status: "signed_out",
      reauthPrompt: null as string | null,
      error: null as string | null,
    },
  },
  rememberedProviders: { onedrive: false, gdrive: false },
  signIn: mockSignIn,
};
jest.mock("./AuthProvider", () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.rememberedProviders = { onedrive: false, gdrive: false };
  for (const provider of Object.values(mockAuth.providers)) {
    provider.status = "signed_out";
    provider.reauthPrompt = null;
    provider.error = null;
  }
});

it("only offers the current provider after previous use and never starts auth automatically", () => {
  mockAuth.rememberedProviders.onedrive = true;
  const { rerender } = render(<ReauthenticationNotice providerId="gdrive" isOnline />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ReauthenticationNotice providerId="onedrive" isOnline />);
  expect(mockSignIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
  expect(mockSignIn).toHaveBeenCalledWith("onedrive");
});

it("hides reminders offline, during auth, after restoration, and after sign-out", () => {
  mockAuth.rememberedProviders.gdrive = true;
  const { rerender } = render(<ReauthenticationNotice providerId="gdrive" isOnline={false} />);
  expect(screen.queryByRole("button")).toBeNull();
  for (const status of ["loading", "signed_in"]) {
    mockAuth.providers.gdrive.status = status;
    rerender(<ReauthenticationNotice providerId="gdrive" isOnline />);
    expect(screen.queryByRole("button")).toBeNull();
  }
  mockAuth.providers.gdrive.status = "signed_out";
  mockAuth.rememberedProviders.gdrive = false;
  rerender(<ReauthenticationNotice providerId="gdrive" isOnline />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("explains permission renewal and renders a failed attempt without opening a popup", () => {
  mockAuth.rememberedProviders.gdrive = true;
  mockAuth.providers.gdrive.reauthPrompt = "consent";
  mockAuth.providers.gdrive.error = "Sign-in was canceled. You can try again.";
  render(<ReauthenticationNotice providerId="gdrive" isOnline />);
  expect(screen.getByText(/needs your permission/)).toBeInTheDocument();
  expect(screen.getByText(/was canceled/)).toBeInTheDocument();
  expect(mockSignIn).not.toHaveBeenCalled();
});
