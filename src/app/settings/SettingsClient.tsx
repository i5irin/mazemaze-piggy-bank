"use client";

import { Button, Spinner, Text } from "@fluentui/react-components";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { isAuthError } from "@/lib/auth/authErrors";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGraphClient } from "@/lib/graph/graphClient";
import { isGraphError } from "@/lib/graph/graphErrors";
import { DEFAULT_TEST_FILE_NAME, createOneDriveService } from "@/lib/onedrive/oneDriveService";

type OperationState = {
  status: "idle" | "working" | "success" | "error";
  message: string | null;
  payload?: unknown;
};

const getUserMessage = (error: unknown): string => {
  if (isAuthError(error)) {
    if (error.code === "missing-config") {
      return "Microsoft sign-in is not configured. Check your .env.local values.";
    }
    if (error.code === "not-signed-in") {
      return "You are not signed in. Please sign in first.";
    }
    return "Microsoft sign-in failed. Please try again.";
  }
  if (isGraphError(error)) {
    if (error.code === "unauthorized") {
      return "Authentication failed. Please sign in again.";
    }
    if (error.code === "forbidden") {
      return "Permission denied. Please consent to the required Graph scopes.";
    }
    if (error.code === "not_found") {
      return "The file or folder was not found.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Please wait and try again.";
    }
    if (error.code === "precondition_failed") {
      return "The data changed on OneDrive. Please reload and try again.";
    }
    if (error.code === "network_error") {
      return "Network error. Check your connection and try again.";
    }
    return "Microsoft Graph request failed. Please try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
};

export function SettingsClient() {
  const { status, account, error, signIn, signOut, getAccessToken } = useAuth();
  const [driveState, setDriveState] = useState<OperationState>({
    status: "idle",
    message: null,
  });

  const graphScopes = useMemo(() => getGraphScopes(), []);
  const tokenProvider = useCallback((scopes: string[]) => getAccessToken(scopes), [getAccessToken]);

  const graphClient = useMemo(
    () =>
      createGraphClient({
        accessTokenProvider: tokenProvider,
        onRetry: (info) => {
          setDriveState((prev) =>
            prev.status === "working"
              ? {
                  ...prev,
                  message: `Rate limited. Retrying in ${Math.ceil(
                    info.delayMs / 1000,
                  )}s (attempt ${info.attempt}/3).`,
                }
              : prev,
          );
        },
      }),
    [tokenProvider],
  );

  const oneDrive = useMemo(
    () => createOneDriveService(graphClient, graphScopes),
    [graphClient, graphScopes],
  );

  const appRootLabel = process.env.NEXT_PUBLIC_ONEDRIVE_APP_ROOT ?? "/Apps/PiggyBank/";

  const signInStatus =
    status === "loading"
      ? "Checking sign-in status..."
      : status === "signed_in"
        ? `Signed in as ${account?.name ?? account?.username ?? "Unknown"}`
        : status === "error"
          ? "Sign-in configuration error"
          : "Not connected";

  const isSignedIn = status === "signed_in";
  const isWorking = driveState.status === "working";
  const isAuthLoading = status === "loading";
  const isAuthBlocked = status === "error";

  const handleEnsureRoot = useCallback(async () => {
    setDriveState({
      status: "working",
      message: "Checking the app folder...",
    });
    try {
      const result = await oneDrive.ensureAppRoot();
      setDriveState({
        status: "success",
        message: "App folder is ready.",
        payload: result,
      });
    } catch (err) {
      setDriveState({
        status: "error",
        message: getUserMessage(err),
      });
    }
  }, [oneDrive]);

  const handleWriteTestFile = useCallback(async () => {
    setDriveState({
      status: "working",
      message: `Writing ${DEFAULT_TEST_FILE_NAME}...`,
    });
    try {
      await oneDrive.ensureAppRoot();
      const payload = {
        message: "Hello from Piggy Bank.",
        updatedAt: new Date().toISOString(),
      };
      const result = await oneDrive.writeJsonFile(DEFAULT_TEST_FILE_NAME, payload);
      setDriveState({
        status: "success",
        message: `Wrote ${DEFAULT_TEST_FILE_NAME}.`,
        payload: result,
      });
    } catch (err) {
      setDriveState({
        status: "error",
        message: getUserMessage(err),
      });
    }
  }, [oneDrive]);

  const handleReadTestFile = useCallback(async () => {
    setDriveState({
      status: "working",
      message: `Reading ${DEFAULT_TEST_FILE_NAME}...`,
    });
    try {
      await oneDrive.ensureAppRoot();
      const result = await oneDrive.readJsonFile(DEFAULT_TEST_FILE_NAME);
      setDriveState({
        status: "success",
        message: `Read ${DEFAULT_TEST_FILE_NAME}.`,
        payload: result,
      });
    } catch (err) {
      setDriveState({
        status: "error",
        message: getUserMessage(err),
      });
    }
  }, [oneDrive]);

  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Settings</h1>
        <p className="app-muted">Manage sign-in, storage, and safety notes.</p>
      </section>

      <section className="card-grid">
        <div className="app-surface">
          <div className="app-muted">Sign-in</div>
          <div style={{ fontWeight: 600 }}>{signInStatus}</div>
        </div>
        <div className="app-surface">
          <div className="app-muted">Data location</div>
          <div style={{ fontWeight: 600 }}>{appRootLabel}</div>
        </div>
        <div className="app-surface">
          <div className="app-muted">Offline mode</div>
          <div style={{ fontWeight: 600 }}>View-only</div>
        </div>
        <div className="app-surface">
          <div className="app-muted">Account type</div>
          <div style={{ fontWeight: 600 }}>Personal Microsoft accounts only</div>
        </div>
      </section>

      <section className="app-surface">
        <h2>Microsoft sign-in</h2>
        <p className="app-muted">Personal Microsoft accounts only.</p>
        <div className="app-actions">
          {status === "signed_in" ? (
            <Button onClick={signOut} disabled={isAuthLoading}>
              Sign out
            </Button>
          ) : (
            <Button appearance="primary" onClick={signIn} disabled={isAuthLoading || isAuthBlocked}>
              Sign in
            </Button>
          )}
          {isAuthLoading ? <Spinner size="tiny" /> : null}
        </div>
        {error ? (
          <div className="app-alert app-alert-error" role="alert">
            <Text>{error}</Text>
          </div>
        ) : null}
      </section>

      <section className="app-surface">
        <h2>OneDrive check</h2>
        <p className="app-muted">
          Uses Microsoft Graph to access the app folder and a test JSON file.
        </p>
        <div className="app-actions">
          <Button onClick={handleEnsureRoot} disabled={!isSignedIn || isWorking}>
            Check app folder
          </Button>
          <Button onClick={handleWriteTestFile} disabled={!isSignedIn || isWorking}>
            Write test file
          </Button>
          <Button onClick={handleReadTestFile} disabled={!isSignedIn || isWorking}>
            Read test file
          </Button>
          {isWorking ? <Spinner size="tiny" /> : null}
        </div>
        <p className="app-muted">Test file: {DEFAULT_TEST_FILE_NAME}</p>
        {driveState.message ? (
          <div
            className={`app-alert ${driveState.status === "error" ? "app-alert-error" : ""}`}
            role="status"
          >
            <Text>{driveState.message}</Text>
          </div>
        ) : null}
        {driveState.payload ? (
          <pre className="app-code">{JSON.stringify(driveState.payload, null, 2)}</pre>
        ) : null}
      </section>

      <section className="app-surface">
        <h2>Data safety</h2>
        <p className="app-muted">
          Your OneDrive folder is used by the app. Deleting it resets all data.
        </p>
      </section>
    </div>
  );
}
