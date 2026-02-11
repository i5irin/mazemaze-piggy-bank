"use client";

import {
  EventType,
  InteractionRequiredAuthError,
  type AccountInfo,
  type EventMessage,
} from "@azure/msal-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthError } from "@/lib/auth/authErrors";
import { getGoogleClientId, getGoogleScopes } from "@/lib/auth/googleConfig";
import { getMsalInstance } from "@/lib/auth/msalClient";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import type { CloudProviderId, ProviderAccount } from "@/lib/storage/types";

type AuthStatus = "loading" | "signed_out" | "signed_in" | "error";

type AuthSignInOptions = {
  prompt?: string;
};

type ProviderSession = {
  providerId: CloudProviderId;
  status: AuthStatus;
  account: ProviderAccount | null;
  error: string | null;
  signIn: (options?: AuthSignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: (scopes: string[]) => Promise<string>;
};

type AuthContextValue = {
  providers: Record<CloudProviderId, ProviderSession>;
  signIn: (providerId: CloudProviderId, options?: AuthSignInOptions) => Promise<void>;
  signOut: (providerId: CloudProviderId) => Promise<void>;
  getAccessToken: (providerId: CloudProviderId, scopes: string[]) => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const toMicrosoftAccount = (account: AccountInfo): ProviderAccount => ({
  name: account.name ?? account.username,
  email: account.username,
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
  return "Something went wrong with sign-in.";
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

const loadGoogleScript = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google sign-in is unavailable on the server."));
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-identity="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google identity services.")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google identity services."));
    document.head.appendChild(script);
  });

const useMicrosoftAuth = (): ProviderSession => {
  const [msalInit] = useState(() => {
    try {
      getMsalInstance();
      return { ready: true, error: null as string | null };
    } catch (err) {
      return { ready: false, error: toAuthErrorMessage(err) };
    }
  });
  const [status, setStatus] = useState<AuthStatus>(() => (msalInit.ready ? "loading" : "error"));
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [error, setError] = useState<string | null>(() => msalInit.error);
  const msalReady = msalInit.ready;

  const syncAccount = useCallback((accountInfo: AccountInfo | null) => {
    setError(null);
    if (!accountInfo) {
      setAccount(null);
      setStatus("signed_out");
      return;
    }
    setAccount(toMicrosoftAccount(accountInfo));
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

  const signIn = useCallback(
    async (options?: AuthSignInOptions) => {
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
          prompt: options?.prompt ?? "select_account",
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
    },
    [msalReady, syncAccount],
  );

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

  return {
    providerId: "onedrive",
    status,
    account,
    error,
    signIn,
    signOut,
    getAccessToken,
  };
};

const useGoogleAuth = (): ProviderSession => {
  const tokenClientRef = useRef<GoogleTokenClient | null>(null);
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scopes = useMemo(() => getGoogleScopes(), []);
  const clientIdRef = useRef<string | null>(null);

  const resolveAccessToken = useCallback((response: GoogleTokenResponse): string => {
    const token = response.access_token?.trim();
    if (!token) {
      throw new AuthError("unknown", "Google sign-in did not return an access token.");
    }
    return token;
  }, []);

  const requestToken = useCallback(
    (prompt?: string): Promise<GoogleTokenResponse> =>
      new Promise((resolve, reject) => {
        const tokenClient = tokenClientRef.current;
        if (!tokenClient || !clientIdRef.current) {
          reject(new AuthError("missing-config", "Google sign-in is not configured."));
          return;
        }
        tokenClient.callback = (response) => {
          if (response.error) {
            reject(new Error(response.error_description ?? response.error));
            return;
          }
          resolve(response);
        };
        tokenClient.requestAccessToken({ prompt });
      }),
    [],
  );

  const loadUserInfo = useCallback(async (accessToken: string): Promise<ProviderAccount> => {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error("Failed to load Google profile.");
    }
    const data = (await response.json()) as { name?: string; email?: string };
    return {
      name: data.name ?? data.email ?? "Google user",
      email: data.email ?? "unknown",
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        const clientId = getGoogleClientId();
        clientIdRef.current = clientId;
        await loadGoogleScript();
        if (!isMounted) {
          return;
        }
        const tokenClient = window.google?.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: scopes.join(" "),
          callback: () => undefined,
        });
        if (!tokenClient) {
          throw new Error("Failed to initialize Google sign-in.");
        }
        tokenClientRef.current = tokenClient;
        setError(null);
        try {
          const response = await requestToken("none");
          const accessToken = resolveAccessToken(response);
          const expiresAt = Date.now() + response.expires_in * 1000;
          tokenRef.current = { value: accessToken, expiresAt };
          let profile: ProviderAccount | null = null;
          try {
            profile = await loadUserInfo(accessToken);
          } catch {
            profile = null;
          }
          if (!isMounted) {
            return;
          }
          setAccount(profile);
          setStatus("signed_in");
        } catch {
          if (!isMounted) {
            return;
          }
          tokenRef.current = null;
          setAccount(null);
          setStatus("signed_out");
        }
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setError(toAuthErrorMessage(err));
        setStatus("error");
      }
    };
    void init();
    return () => {
      isMounted = false;
    };
  }, [loadUserInfo, requestToken, resolveAccessToken, scopes]);

  const signIn = useCallback(
    async (options?: AuthSignInOptions) => {
      setError(null);
      if (!tokenClientRef.current) {
        setError("Google sign-in is not configured.");
        setStatus("error");
        return;
      }
      try {
        setStatus("loading");
        const response = await requestToken(options?.prompt ?? "select_account");
        const accessToken = resolveAccessToken(response);
        const expiresAt = Date.now() + response.expires_in * 1000;
        tokenRef.current = { value: accessToken, expiresAt };
        const profile = await loadUserInfo(accessToken);
        setAccount(profile);
        setStatus("signed_in");
      } catch (err) {
        setError(toAuthErrorMessage(err));
        if (!tokenRef.current) {
          setStatus("signed_out");
        }
      }
    },
    [loadUserInfo, requestToken, resolveAccessToken],
  );

  const signOut = useCallback(async () => {
    setError(null);
    const token = tokenRef.current?.value ?? null;
    if (token && window.google?.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => undefined);
    }
    tokenRef.current = null;
    setAccount(null);
    setStatus("signed_out");
  }, []);

  const getAccessToken = useCallback(
    async (_scopes: string[]) => {
      void _scopes;
      const token = tokenRef.current;
      if (token && token.expiresAt > Date.now() + 30_000) {
        return token.value;
      }
      if (!tokenClientRef.current) {
        throw new AuthError("missing-config", "Google sign-in is not configured.");
      }
      try {
        const response = await requestToken("");
        const accessToken = resolveAccessToken(response);
        const expiresAt = Date.now() + response.expires_in * 1000;
        tokenRef.current = { value: accessToken, expiresAt };
        if (!account) {
          const profile = await loadUserInfo(accessToken);
          setAccount(profile);
        }
        setStatus("signed_in");
        return accessToken;
      } catch (err) {
        setError(toAuthErrorMessage(err));
        setStatus(account ? "signed_in" : "signed_out");
        throw new AuthError("interaction-required", "Google sign-in required.");
      }
    },
    [account, loadUserInfo, requestToken, resolveAccessToken],
  );

  return {
    providerId: "gdrive",
    status,
    account,
    error,
    signIn,
    signOut,
    getAccessToken,
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const microsoft = useMicrosoftAuth();
  const google = useGoogleAuth();

  const providers = useMemo(
    () => ({
      onedrive: microsoft,
      gdrive: google,
    }),
    [google, microsoft],
  );

  const signIn = useCallback(
    async (providerId: CloudProviderId, options?: AuthSignInOptions) => {
      await providers[providerId].signIn(options);
    },
    [providers],
  );

  const signOut = useCallback(
    async (providerId: CloudProviderId) => {
      await providers[providerId].signOut();
    },
    [providers],
  );

  const getAccessToken = useCallback(
    async (providerId: CloudProviderId, scopes: string[]) =>
      providers[providerId].getAccessToken(scopes),
    [providers],
  );

  const value = useMemo(
    () => ({
      providers,
      signIn,
      signOut,
      getAccessToken,
    }),
    [getAccessToken, providers, signIn, signOut],
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
