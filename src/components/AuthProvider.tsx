"use client";

import {
  EventType,
  InteractionRequiredAuthError,
  type AccountInfo,
  type EventMessage,
} from "@azure/msal-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AuthError } from "@/lib/auth/authErrors";
import { getMsalInstance } from "@/lib/auth/msalClient";
import { getGraphScopes } from "@/lib/auth/msalConfig";

type AuthStatus = "loading" | "signed_out" | "signed_in" | "error";

type AccountSummary = {
  name: string;
  username: string;
};

type AuthContextValue = {
  status: AuthStatus;
  account: AccountSummary | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: (scopes: string[]) => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const toAccountSummary = (account: AccountInfo): AccountSummary => ({
  name: account.name ?? account.username,
  username: account.username,
});

const pickAccount = (accounts: AccountInfo[]): AccountInfo | null => {
  if (accounts.length === 0) {
    return null;
  }
  return accounts[0];
};

const toAuthErrorMessage = (error: unknown): string => {
  if (error instanceof AuthError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong with Microsoft sign-in.";
};

const handleAuthEvent = (
  message: EventMessage,
  updateAccount: (account: AccountInfo | null) => void,
  setStatus: (status: AuthStatus) => void,
) => {
  switch (message.eventType) {
    case EventType.LOGIN_SUCCESS: {
      const result = message.payload as { account?: AccountInfo } | null;
      updateAccount(result?.account ?? null);
      setStatus(result?.account ? "signed_in" : "signed_out");
      break;
    }
    case EventType.LOGOUT_SUCCESS: {
      updateAccount(null);
      setStatus("signed_out");
      break;
    }
    default:
      break;
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [msalInit] = useState(() => {
    try {
      getMsalInstance();
      return { ready: true, error: null as string | null };
    } catch (err) {
      return { ready: false, error: toAuthErrorMessage(err) };
    }
  });
  const [status, setStatus] = useState<AuthStatus>(() => (msalInit.ready ? "loading" : "error"));
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(() => msalInit.error);
  const msalReady = msalInit.ready;

  const syncAccount = useCallback((accountInfo: AccountInfo | null) => {
    setError(null);
    if (!accountInfo) {
      setAccount(null);
      setStatus("signed_out");
      return;
    }
    setAccount(toAccountSummary(accountInfo));
    setStatus("signed_in");
  }, []);

  useEffect(() => {
    if (!msalReady) {
      return;
    }
    const msalInstance = getMsalInstance();
    let isMounted = true;

    const initialize = async () => {
      try {
        await msalInstance.initialize();
        const result = await msalInstance.handleRedirectPromise();
        if (!isMounted) {
          return;
        }
        if (result?.account) {
          msalInstance.setActiveAccount(result.account);
          syncAccount(result.account);
          return;
        }
        const currentAccount =
          msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts());
        syncAccount(currentAccount);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError(toAuthErrorMessage(err));
        setStatus("error");
      }
    };

    void initialize();

    const callbackId = msalInstance.addEventCallback((message) => {
      if (!isMounted) {
        return;
      }
      handleAuthEvent(message, syncAccount, setStatus);
    });

    return () => {
      isMounted = false;
      if (callbackId) {
        msalInstance.removeEventCallback(callbackId);
      }
    };
  }, [msalReady, syncAccount]);

  const signIn = useCallback(async () => {
    setError(null);
    if (!msalReady) {
      setError("Microsoft sign-in is not configured.");
      setStatus("error");
      return;
    }
    const msalInstance = getMsalInstance();
    try {
      setStatus("loading");
      const result = await msalInstance.loginPopup({
        scopes: getGraphScopes(),
        prompt: "select_account",
      });
      if (result.account) {
        msalInstance.setActiveAccount(result.account);
      }
      syncAccount(result.account ?? pickAccount(msalInstance.getAllAccounts()));
    } catch (err) {
      setError(toAuthErrorMessage(err));
      const currentAccount = pickAccount(msalInstance.getAllAccounts());
      syncAccount(currentAccount);
    }
  }, [msalReady, syncAccount]);

  const signOut = useCallback(async () => {
    setError(null);
    if (!msalReady) {
      setError("Microsoft sign-in is not configured.");
      setStatus("error");
      return;
    }
    const msalInstance = getMsalInstance();
    try {
      setStatus("loading");
      const currentAccount =
        msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts());
      await msalInstance.logoutPopup({
        account: currentAccount ?? undefined,
      });
      syncAccount(null);
    } catch (err) {
      setError(toAuthErrorMessage(err));
      const currentAccount = pickAccount(msalInstance.getAllAccounts());
      syncAccount(currentAccount);
    }
  }, [msalReady, syncAccount]);

  const getAccessToken = useCallback(
    async (scopes: string[]) => {
      if (!msalReady) {
        throw new AuthError("missing-config", "Microsoft sign-in is not configured.");
      }
      const msalInstance = getMsalInstance();
      const currentAccount =
        msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts());
      if (!currentAccount) {
        throw new AuthError("not-signed-in", "You are not signed in.");
      }
      try {
        const result = await msalInstance.acquireTokenSilent({
          account: currentAccount,
          scopes,
        });
        return result.accessToken;
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) {
          const result = await msalInstance.acquireTokenPopup({ scopes });
          if (result.account) {
            msalInstance.setActiveAccount(result.account);
            syncAccount(result.account);
          }
          return result.accessToken;
        }
        throw err;
      }
    },
    [msalReady, syncAccount],
  );

  const value = useMemo(
    () => ({
      status,
      account,
      error,
      signIn,
      signOut,
      getAccessToken,
    }),
    [status, account, error, signIn, signOut, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("AuthProvider is missing in the component tree.");
  }
  return context;
};
