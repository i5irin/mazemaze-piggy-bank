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
import { rememberConnection, useConnectionMemory } from "@/lib/auth/connectionMemory";
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
  reauthPrompt: "consent" | "select_account" | null;
  requireReauthentication: (prompt?: "consent" | "select_account") => void;
  signIn: (options?: AuthSignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: (scopes: string[]) => Promise<string>;
};

type AuthContextValue = {
  providers: Record<CloudProviderId, ProviderSession>;
  rememberedProviders: Record<CloudProviderId, boolean>;
  signIn: (providerId: CloudProviderId, options?: AuthSignInOptions) => Promise<void>;
  signOut: (providerId: CloudProviderId) => Promise<void>;
  getAccessToken: (providerId: CloudProviderId, scopes: string[]) => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const toMicrosoftAccount = (account: AccountInfo): ProviderAccount => ({
  id: account.homeAccountId,
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
  const [reauthPrompt, setReauthPrompt] = useState<"consent" | "select_account" | null>(null);
  const interactionRequired = useRef(false);
  const generation = useRef(0);
  const interactive = useRef(false);
  const requireReauthentication = useCallback(
    (prompt: "consent" | "select_account" = "select_account") => {
      interactionRequired.current = true;
      setReauthPrompt((previous) => (previous === "consent" ? previous : prompt));
      setStatus("signed_out");
    },
    [],
  );

  const syncAccount = useCallback((accountInfo: AccountInfo | null) => {
    setError(null);
    if (!accountInfo) {
      setAccount(null);
      setStatus("signed_out");
      return;
    }
    interactionRequired.current = false;
    setReauthPrompt(null);
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
          rememberConnection("onedrive", true);
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
      if (interactive.current) return;
      setError(null);
      if (!msalReady) {
        setError("Microsoft sign-in is not configured.");
        setStatus("error");
        return;
      }
      const msalInstance = getMsalInstance();
      interactive.current = true;
      const request = ++generation.current;
      try {
        setStatus("loading");
        const result = await msalInstance.loginPopup({
          scopes: getGraphScopes(),
          prompt: options?.prompt ?? reauthPrompt ?? "select_account",
        });
        if (request !== generation.current) return;
        if (result.account) {
          msalInstance.setActiveAccount(result.account);
        }
        const connected = result.account ?? pickAccount(msalInstance.getAllAccounts());
        syncAccount(connected);
        if (connected) rememberConnection("onedrive", true);
      } catch (err) {
        if (request !== generation.current) return;
        if (interactionRequired.current) setStatus("signed_out");
        else
          syncAccount(
            msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts()),
          );
        setError(toAuthErrorMessage(err));
      } finally {
        interactive.current = false;
      }
    },
    [msalReady, reauthPrompt, syncAccount],
  );

  const signOut = useCallback(async () => {
    if (interactive.current) return;
    setError(null);
    if (!msalReady) {
      setError("Microsoft sign-in is not configured.");
      setStatus("error");
      return;
    }
    const msalInstance = getMsalInstance();
    interactive.current = true;
    generation.current++;
    try {
      setStatus("loading");
      const currentAccount =
        msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts());
      await msalInstance.logoutPopup({
        account: currentAccount ?? undefined,
      });
      interactionRequired.current = true;
      setReauthPrompt(null);
      rememberConnection("onedrive", false);
      syncAccount(null);
    } catch (err) {
      const currentAccount =
        msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts());
      if (interactionRequired.current) setStatus("signed_out");
      else syncAccount(currentAccount);
      setError(toAuthErrorMessage(err));
    } finally {
      interactive.current = false;
    }
  }, [msalReady, syncAccount]);

  const getAccessToken = useCallback(
    async (scopes: string[]) => {
      if (!msalReady) {
        throw new AuthError("missing-config", "Microsoft sign-in is not configured.");
      }
      if (interactionRequired.current || interactive.current) {
        throw new AuthError("interaction-required", "Microsoft sign-in required.");
      }
      const request = generation.current;
      const msalInstance = getMsalInstance();
      const currentAccount =
        msalInstance.getActiveAccount() ?? pickAccount(msalInstance.getAllAccounts());
      if (!currentAccount) {
        requireReauthentication();
        throw new AuthError("not-signed-in", "You are not signed in.");
      }
      try {
        const result = await msalInstance.acquireTokenSilent({
          account: currentAccount,
          scopes,
        });
        if (request !== generation.current || interactionRequired.current)
          throw new AuthError("interaction-required", "Microsoft sign-in required.");
        rememberConnection("onedrive", true);
        return result.accessToken;
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) {
          if (request === generation.current) requireReauthentication();
          throw new AuthError("interaction-required", "Microsoft sign-in required.");
        }
        throw err;
      }
    },
    [msalReady, requireReauthentication],
  );

  return {
    providerId: "onedrive",
    status,
    account,
    error,
    reauthPrompt,
    requireReauthentication,
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
  const pendingReject = useRef<((error: Error) => void) | null>(null);
  const generation = useRef(0);
  const interactive = useRef(false);
  const cancelPendingRequest = useCallback(() => {
    generation.current++;
    pendingReject.current?.(new Error("Sign-in was interrupted."));
  }, []);
  const [reauthPrompt, setReauthPrompt] = useState<"consent" | "select_account" | null>(null);
  const requireReauthentication = useCallback(
    (prompt: "consent" | "select_account" = "select_account") => {
      tokenRef.current = null;
      setReauthPrompt((previous) => (previous === "consent" ? previous : prompt));
      setStatus("signed_out");
    },
    [],
  );

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
        if (pendingReject.current) {
          reject(new Error("Sign-in is already in progress."));
          return;
        }
        const finishReject = (error: Error) => {
          pendingReject.current = null;
          reject(error);
        };
        pendingReject.current = finishReject;
        tokenClient.callback = (response) => {
          pendingReject.current = null;
          if (response.error) {
            reject(new Error(response.error_description ?? response.error));
            return;
          }
          resolve(response);
        };
        try {
          tokenClient.requestAccessToken({ prompt });
        } catch (error) {
          finishReject(error instanceof Error ? error : new Error("Google sign-in failed."));
        }
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
          error_callback: (error) => {
            pendingReject.current?.(
              new Error(
                error.type === "popup_closed"
                  ? "Sign-in was canceled. You can try again."
                  : "Could not open Google sign-in. Allow popups for this site and try again.",
              ),
            );
          },
        });
        if (!tokenClient) {
          throw new Error("Failed to initialize Google sign-in.");
        }
        tokenClientRef.current = tokenClient;
        setError(null);
        setStatus("signed_out");
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
      cancelPendingRequest();
    };
  }, [scopes, cancelPendingRequest]);

  const signIn = useCallback(
    async (options?: AuthSignInOptions) => {
      if (interactive.current) return;
      setError(null);
      if (!tokenClientRef.current) {
        setError("Google sign-in is not configured.");
        setStatus("error");
        return;
      }
      interactive.current = true;
      const request = ++generation.current;
      try {
        setStatus("loading");
        const response = await requestToken(options?.prompt ?? reauthPrompt ?? "select_account");
        const accessToken = resolveAccessToken(response);
        const expiresAt = Date.now() + response.expires_in * 1000;
        const profile = await loadUserInfo(accessToken);
        if (request !== generation.current) return;
        tokenRef.current = { value: accessToken, expiresAt };
        setReauthPrompt(null);
        rememberConnection("gdrive", true);
        setAccount(profile);
        setStatus("signed_in");
      } catch (err) {
        if (request !== generation.current) return;
        setError(toAuthErrorMessage(err));
        setStatus(
          tokenRef.current && tokenRef.current.expiresAt > Date.now() + 30_000
            ? "signed_in"
            : "signed_out",
        );
      } finally {
        interactive.current = false;
      }
    },
    [loadUserInfo, requestToken, resolveAccessToken, reauthPrompt],
  );

  const signOut = useCallback(async () => {
    generation.current++;
    pendingReject.current?.(new Error("Sign-in was interrupted."));
    rememberConnection("gdrive", false);
    setReauthPrompt(null);
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
      requireReauthentication();
      throw new AuthError("interaction-required", "Google sign-in required.");
    },
    [requireReauthentication],
  );

  return {
    providerId: "gdrive",
    status,
    account,
    error,
    reauthPrompt,
    requireReauthentication,
    signIn,
    signOut,
    getAccessToken,
  };
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const microsoft = useMicrosoftAuth();
  const google = useGoogleAuth();
  const rememberedProviders = useConnectionMemory();

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
      rememberedProviders,
      signIn,
      signOut,
      getAccessToken,
    }),
    [getAccessToken, providers, rememberedProviders, signIn, signOut],
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
