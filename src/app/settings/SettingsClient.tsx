"use client";

import { Button, Spinner, Text } from "@fluentui/react-components";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useSharedSelection } from "@/components/SharedSelectionProvider";
import { isAuthError } from "@/lib/auth/authErrors";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGraphClient } from "@/lib/graph/graphClient";
import { isGraphError } from "@/lib/graph/graphErrors";
import {
  DEFAULT_TEST_FILE_NAME,
  createOneDriveService,
  type SharedRootReference,
} from "@/lib/onedrive/oneDriveService";

type OperationState = {
  status: "idle" | "working" | "success" | "error";
  message: string | null;
  payload?: unknown;
};

const sensitiveKeys = [
  "authorization",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "password",
  "secret",
  "token",
];
const emailKeys = ["email", "userPrincipalName", "upn"];
const idKeys = ["id", "driveId", "itemId", "siteId", "tenantId", "userId"];

const maskId = (value: string): string => {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const maskEmail = (value: string): string => {
  const atIndex = value.indexOf("@");
  if (atIndex <= 1) {
    return "***";
  }
  return `${value.slice(0, 1)}***${value.slice(atIndex)}`;
};

const looksLikeJwt = (value: string): boolean => {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length >= 10);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const maskSensitiveData = (value: unknown, parentKey?: string): unknown => {
  if (typeof value === "string") {
    const key = parentKey?.toLowerCase() ?? "";
    if (sensitiveKeys.some((entry) => key.includes(entry.toLowerCase()))) {
      return "[REDACTED]";
    }
    if (emailKeys.some((entry) => key.includes(entry.toLowerCase()))) {
      return maskEmail(value);
    }
    if (idKeys.some((entry) => key === entry.toLowerCase())) {
      return maskId(value);
    }
    if (looksLikeJwt(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveData(item, parentKey));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, maskSensitiveData(entry, key)]),
    );
  }
  return value;
};

const formatPayload = (payload: unknown): string =>
  JSON.stringify(maskSensitiveData(payload), null, 2);

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

const buildExportTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
};

export function SettingsClient() {
  const { status, account, error, signIn, signOut, getAccessToken } = useAuth();
  const { selection } = useSharedSelection();
  const [driveState, setDriveState] = useState<OperationState>({
    status: "idle",
    message: null,
  });
  const [exportState, setExportState] = useState<OperationState>({
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
  const sharedRoot = useMemo<SharedRootReference | null>(() => {
    if (!selection) {
      return null;
    }
    return {
      sharedId: selection.sharedId,
      driveId: selection.driveId,
      itemId: selection.itemId,
    };
  }, [selection]);
  const sharedLocationLabel = useMemo(
    () => (selection ? `${selection.name} (${selection.sharedId})` : "Not selected"),
    [selection],
  );

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
  const isExportWorking = exportState.status === "working";
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

  const handleExportSnapshot = useCallback(
    async (scope: "personal" | "shared") => {
      if (!isSignedIn) {
        setExportState({ status: "error", message: "Sign in to export data." });
        return;
      }
      if (scope === "shared" && !sharedRoot) {
        setExportState({ status: "error", message: "Select a shared space first." });
        return;
      }
      setExportState({
        status: "working",
        message: `Preparing ${scope} snapshot export...`,
      });
      try {
        const timestamp = buildExportTimestamp();
        if (scope === "personal") {
          await oneDrive.ensureAppRoot();
          const result = await oneDrive.readPersonalSnapshot();
          const payload = JSON.stringify(result.snapshot, null, 2);
          downloadBlob(
            new Blob([payload], { type: "application/json" }),
            `mazemaze-piggy-bank-personal-snapshot-${timestamp}.json`,
          );
        } else {
          const result = await oneDrive.readSharedSnapshot(sharedRoot as SharedRootReference);
          const payload = JSON.stringify(result.snapshot, null, 2);
          downloadBlob(
            new Blob([payload], { type: "application/json" }),
            `mazemaze-piggy-bank-shared-snapshot-${timestamp}.json`,
          );
        }
        setExportState({
          status: "success",
          message: `Downloaded ${scope} snapshot.`,
        });
      } catch (err) {
        setExportState({ status: "error", message: getUserMessage(err) });
      }
    },
    [isSignedIn, oneDrive, sharedRoot],
  );

  const handleExportEvents = useCallback(
    async (scope: "personal" | "shared") => {
      if (!isSignedIn) {
        setExportState({ status: "error", message: "Sign in to export data." });
        return;
      }
      if (scope === "shared" && !sharedRoot) {
        setExportState({ status: "error", message: "Select a shared space first." });
        return;
      }
      setExportState({
        status: "working",
        message: `Preparing ${scope} event export...`,
      });
      try {
        const timestamp = buildExportTimestamp();
        const chunkIds =
          scope === "personal"
            ? await oneDrive.listEventChunkIds()
            : await oneDrive.listSharedEventChunkIds(sharedRoot as SharedRootReference);
        if (chunkIds.length === 0) {
          setExportState({ status: "error", message: "No event logs found to export." });
          return;
        }
        const sortedChunkIds = [...chunkIds].sort((a, b) => a - b);
        const chunks = await Promise.all(
          sortedChunkIds.map((chunkId) =>
            scope === "personal"
              ? oneDrive.readEventChunk(chunkId)
              : oneDrive.readSharedEventChunk(sharedRoot as SharedRootReference, chunkId),
          ),
        );
        const payload = chunks.join("\n");
        downloadBlob(
          new Blob([payload], { type: "text/plain" }),
          `mazemaze-piggy-bank-${scope}-events-${timestamp}.jsonl`,
        );
        setExportState({
          status: "success",
          message: `Downloaded ${scope} event logs.`,
        });
      } catch (err) {
        setExportState({ status: "error", message: getUserMessage(err) });
      }
    },
    [isSignedIn, oneDrive, sharedRoot],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!window.location.hash) {
      return;
    }
    const targetId = window.location.hash.replace("#", "");
    if (!targetId) {
      return;
    }
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Settings</h1>
        <p className="app-muted">Manage sign-in, storage, and safety notes.</p>
      </section>

      <section className="app-surface" id="sync-status">
        <h2>Sync & connection</h2>
        <p className="app-muted">
          Check your sign-in status, OneDrive locations, and offline availability.
        </p>
        <div className="card-grid">
          <div className="app-surface">
            <div className="app-muted">Sign-in</div>
            <div style={{ fontWeight: 600 }}>{signInStatus}</div>
          </div>
          <div className="app-surface">
            <div className="app-muted">Personal data location</div>
            <div style={{ fontWeight: 600 }}>{appRootLabel}</div>
          </div>
          <div className="app-surface">
            <div className="app-muted">Shared data location</div>
            <div style={{ fontWeight: 600 }}>{sharedLocationLabel}</div>
          </div>
          <div className="app-surface">
            <div className="app-muted">Offline mode</div>
            <div style={{ fontWeight: 600 }}>View-only</div>
          </div>
          <div className="app-surface">
            <div className="app-muted">Account type</div>
            <div style={{ fontWeight: 600 }}>Personal Microsoft accounts only</div>
          </div>
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
          <pre className="app-code">{formatPayload(driveState.payload)}</pre>
        ) : null}
      </section>

      <section className="app-surface">
        <h2>Export</h2>
        <p className="app-muted">
          Download snapshots and event logs for personal data or the selected shared space.
        </p>
        <div className="app-actions">
          <Button
            onClick={() => handleExportSnapshot("personal")}
            disabled={!isSignedIn || isExportWorking}
          >
            Download personal snapshot
          </Button>
          <Button
            onClick={() => handleExportEvents("personal")}
            disabled={!isSignedIn || isExportWorking}
          >
            Download personal events
          </Button>
          <Button
            onClick={() => handleExportSnapshot("shared")}
            disabled={!isSignedIn || isExportWorking || !sharedRoot}
          >
            Download shared snapshot
          </Button>
          <Button
            onClick={() => handleExportEvents("shared")}
            disabled={!isSignedIn || isExportWorking || !sharedRoot}
          >
            Download shared events
          </Button>
          {isExportWorking ? <Spinner size="tiny" /> : null}
        </div>
        {exportState.message ? (
          <div
            className={`app-alert ${exportState.status === "error" ? "app-alert-error" : ""}`}
            role="status"
          >
            <Text>{exportState.message}</Text>
          </div>
        ) : null}
      </section>

      <section className="app-surface">
        <h2>Data safety</h2>
        <p className="app-muted">
          The app stores data in your OneDrive folders. Deleting the personal app folder or the
          selected shared folder resets the data in that space.
        </p>
        <p className="app-muted">
          Avoid editing or renaming files inside the app folders. If you need a backup, copy the
          folder instead of editing it in place.
        </p>
        <p className="app-muted">
          To reset, delete the entire root folder in OneDrive. This permanently removes snapshots,
          events, and lease files.
        </p>
        <p className="app-muted">
          If you delete a shared folder, all collaborators lose access to that shared data.
        </p>
      </section>
    </div>
  );
}
