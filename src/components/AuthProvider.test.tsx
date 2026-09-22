import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { AuthProvider, useAuth } from "./AuthProvider";
import { CONNECTION_MEMORY_KEY, rememberConnection } from "@/lib/auth/connectionMemory";

jest.mock("@/lib/auth/msalClient", () => ({ getMsalInstance: () => mockMsal }));
jest.mock("@/lib/auth/msalConfig", () => ({
  getGraphScopes: () => ["User.Read", "Files.ReadWrite"],
}));
jest.mock("@/lib/auth/googleConfig", () => ({
  getGoogleClientId: () => "public-client",
  getGoogleScopes: () => ["openid", "drive.file"],
}));

const account = { homeAccountId: "account-a", username: "synthetic@example.test" };
let mockAccount: typeof account | null = null;
const mockMsal = {
  initialize: jest.fn(),
  handleRedirectPromise: jest.fn(),
  getActiveAccount: jest.fn(() => mockAccount),
  getAllAccounts: jest.fn(() => (mockAccount ? [mockAccount] : [])),
  setActiveAccount: jest.fn((value: typeof mockAccount) => {
    mockAccount = value;
  }),
  addEventCallback: jest.fn(),
  removeEventCallback: jest.fn(),
  loginPopup: jest.fn(),
  logoutPopup: jest.fn(),
  acquireTokenSilent: jest.fn(),
  acquireTokenPopup: jest.fn(),
};
let googleConfig: Parameters<GoogleAccounts["oauth2"]["initTokenClient"]>[0];
const googleClient: GoogleTokenClient = {
  callback: () => undefined,
  requestAccessToken: jest.fn(),
};
const token: GoogleTokenResponse = {
  access_token: "synthetic-token",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "openid drive.file",
};
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockAccount = null;
  mockMsal.initialize.mockResolvedValue(undefined);
  mockMsal.handleRedirectPromise.mockResolvedValue(null);
  mockMsal.loginPopup.mockResolvedValue({ account });
  mockMsal.logoutPopup.mockImplementation(async () => {
    mockAccount = null;
  });
  mockMsal.acquireTokenSilent.mockResolvedValue({ accessToken: "synthetic-ms-token" });
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config) => {
          googleConfig = config;
          return googleClient;
        },
        revoke: jest.fn(),
      },
    },
  };
  jest
    .mocked(googleClient.requestAccessToken)
    .mockImplementation(() => googleClient.callback(token));
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: "Synthetic", email: "synthetic@example.test" }),
  });
});

async function setup() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.providers.gdrive.status).toBe("signed_out"));
  await waitFor(() => expect(hook.result.current.providers.onedrive.status).not.toBe("loading"));
  return hook;
}

it("does not open either provider at startup or infer use from the default selection", async () => {
  localStorage.setItem("mazemaze-piggy-bank-storage-provider", "onedrive");
  const { result } = await setup();
  expect(result.current.rememberedProviders).toEqual({ gdrive: false, onedrive: false });
  expect(googleClient.requestAccessToken).not.toHaveBeenCalled();
  expect(mockMsal.loginPopup).not.toHaveBeenCalled();
  expect(mockMsal.acquireTokenPopup).not.toHaveBeenCalled();
});

it("remembers successful Google sign-in without storing credentials and restores only the preference", async () => {
  const { result, unmount } = await setup();
  await act(() => result.current.signIn("gdrive"));
  expect(result.current.providers.gdrive.status).toBe("signed_in");
  expect(JSON.parse(localStorage.getItem(CONNECTION_MEMORY_KEY)!)).toEqual({
    gdrive: true,
    onedrive: false,
  });
  expect(localStorage.getItem(CONNECTION_MEMORY_KEY)).not.toMatch(/token|email|Synthetic/);
  unmount();
  jest.mocked(googleClient.requestAccessToken).mockClear();
  const reopened = await setup();
  expect(reopened.result.current.rememberedProviders.gdrive).toBe(true);
  expect(googleClient.requestAccessToken).not.toHaveBeenCalled();
});

it.each(["popup_failed_to_open", "popup_closed"])(
  "settles %s and allows a later Google retry",
  async (type) => {
    const { result } = await setup();
    jest
      .mocked(googleClient.requestAccessToken)
      .mockImplementationOnce(() => googleConfig.error_callback?.({ type }));
    await act(() => result.current.signIn("gdrive"));
    expect(result.current.providers.gdrive.status).toBe("signed_out");
    expect(result.current.providers.gdrive.error).toBeTruthy();
    expect(result.current.rememberedProviders.gdrive).toBe(false);
    await act(() => result.current.signIn("gdrive"));
    expect(result.current.providers.gdrive.status).toBe("signed_in");
  },
);

it("requires an explicit Google action after expiry and permission loss", async () => {
  const { result } = await setup();
  jest
    .mocked(googleClient.requestAccessToken)
    .mockImplementationOnce(() => googleClient.callback({ ...token, expires_in: 0 }));
  await act(() => result.current.signIn("gdrive"));
  await act(async () => {
    await expect(result.current.getAccessToken("gdrive", [])).rejects.toMatchObject({
      code: "interaction-required",
    });
  });
  expect(googleClient.requestAccessToken).toHaveBeenCalledTimes(1);
  expect(result.current.providers.gdrive.status).toBe("signed_out");
  act(() => result.current.providers.gdrive.requireReauthentication("consent"));
  await act(async () => {
    await expect(result.current.getAccessToken("gdrive", [])).rejects.toMatchObject({
      code: "interaction-required",
    });
  });
  await act(() => result.current.signIn("gdrive"));
  expect(googleClient.requestAccessToken).toHaveBeenLastCalledWith({ prompt: "consent" });
  expect(result.current.providers.gdrive.reauthPrompt).toBeNull();
});

it("keeps Microsoft silent renewal and remembers a successfully restored connection", async () => {
  mockAccount = account;
  const { result } = await setup();
  expect(result.current.providers.onedrive.status).toBe("signed_in");
  await act(async () => {
    expect(await result.current.getAccessToken("onedrive", ["Files.ReadWrite"])).toBe(
      "synthetic-ms-token",
    );
  });
  expect(result.current.rememberedProviders.onedrive).toBe(true);
  expect(mockMsal.acquireTokenSilent).toHaveBeenCalled();
  expect(mockMsal.acquireTokenPopup).not.toHaveBeenCalled();
});

it("does not open Microsoft on silent failure and recovers after explicit retry", async () => {
  mockAccount = account;
  rememberConnection("onedrive", true);
  const { result } = await setup();
  mockMsal.acquireTokenSilent.mockRejectedValueOnce(
    new InteractionRequiredAuthError("interaction_required"),
  );
  await act(async () => {
    await expect(result.current.getAccessToken("onedrive", [])).rejects.toMatchObject({
      code: "interaction-required",
    });
  });
  expect(result.current.providers.onedrive.status).toBe("signed_out");
  expect(mockMsal.acquireTokenPopup).not.toHaveBeenCalled();
  mockMsal.loginPopup.mockRejectedValueOnce(new Error("User canceled sign-in."));
  await act(() => result.current.signIn("onedrive"));
  expect(result.current.providers.onedrive.status).toBe("signed_out");
  expect(result.current.providers.onedrive.error).toContain("canceled");
  await act(() => result.current.signIn("onedrive"));
  expect(result.current.providers.onedrive.status).toBe("signed_in");
});

it.each(["onedrive", "gdrive"] as const)(
  "suppresses %s reminders after explicit sign-out, including reload",
  async (provider) => {
    const { result, unmount } = await setup();
    await act(() => result.current.signIn(provider));
    expect(result.current.rememberedProviders[provider]).toBe(true);
    await act(() => result.current.signOut(provider));
    expect(result.current.rememberedProviders[provider]).toBe(false);
    expect(result.current.providers[provider].status).toBe("signed_out");
    unmount();
    const reopened = await setup();
    expect(reopened.result.current.rememberedProviders[provider]).toBe(false);
  },
);

it("ignores corrupt connection preferences and tolerates unavailable local storage", async () => {
  localStorage.setItem(CONNECTION_MEMORY_KEY, "not-json");
  const { result } = await setup();
  expect(result.current.rememberedProviders.gdrive).toBe(false);
  const blocked = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  await act(() => result.current.signIn("gdrive"));
  expect(result.current.providers.gdrive.status).toBe("signed_in");
  blocked.mockRestore();
});

it("prevents duplicate Google popups and ignores completion after sign-out", async () => {
  const { result } = await setup();
  jest.mocked(googleClient.requestAccessToken).mockImplementationOnce(() => undefined);
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.signIn("gdrive");
  });
  await act(() => result.current.signIn("gdrive"));
  expect(googleClient.requestAccessToken).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.signOut("gdrive");
    googleClient.callback(token);
    await pending;
  });
  expect(result.current.providers.gdrive.status).toBe("signed_out");
  expect(result.current.rememberedProviders.gdrive).toBe(false);
});

it("does not restore a Microsoft connection from an old silent request after sign-out", async () => {
  mockAccount = account;
  const { result } = await setup();
  let finish!: (value: { accessToken: string }) => void;
  mockMsal.acquireTokenSilent.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = result.current.getAccessToken("onedrive", []);
  await act(async () => {
    await result.current.signOut("onedrive");
    finish({ accessToken: "old-synthetic-token" });
    await expect(pending).rejects.toMatchObject({ code: "interaction-required" });
  });
  expect(result.current.providers.onedrive.status).toBe("signed_out");
  expect(result.current.rememberedProviders.onedrive).toBe(false);
});

it("does not demand Microsoft reauthentication for a transient network failure", async () => {
  mockAccount = account;
  const { result } = await setup();
  mockMsal.acquireTokenSilent.mockRejectedValueOnce(new Error("Network unavailable"));
  await act(async () => {
    await expect(result.current.getAccessToken("onedrive", [])).rejects.toThrow(
      "Network unavailable",
    );
  });
  expect(result.current.providers.onedrive.status).toBe("signed_in");
  expect(result.current.providers.onedrive.reauthPrompt).toBeNull();
  expect(mockMsal.acquireTokenPopup).not.toHaveBeenCalled();
});
