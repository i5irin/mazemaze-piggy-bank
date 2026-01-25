"use client";

import { Button, Spinner, Text } from "@fluentui/react-components";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useSharedSelection } from "@/components/SharedSelectionProvider";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGraphClient } from "@/lib/graph/graphClient";
import { isGraphError } from "@/lib/graph/graphErrors";
import { createOneDriveService, type SharedRootListItem } from "@/lib/onedrive/oneDriveService";
import { useOnlineStatus } from "@/lib/persistence/useOnlineStatus";

type SharedListState = {
  status: "idle" | "loading" | "error";
  message: string | null;
  withMe: SharedRootListItem[];
  byMe: SharedRootListItem[];
};

const getUserMessage = (error: unknown): string => {
  if (isGraphError(error)) {
    if (error.code === "unauthorized") {
      return "Authentication failed. Please sign in again.";
    }
    if (error.code === "forbidden") {
      return "Permission denied. Please consent to the required Graph scopes.";
    }
    if (error.code === "not_found") {
      return "The shared items list was not found.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Please wait and try again.";
    }
    if (error.code === "network_error") {
      return "Network error. Please check your connection.";
    }
    return "Microsoft Graph request failed. Please try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
};

export default function SharedClient() {
  const { status: authStatus, getAccessToken } = useAuth();
  const { selection, setSelection, clearSelection } = useSharedSelection();
  const isOnline = useOnlineStatus();
  const isSignedIn = authStatus === "signed_in";

  const [listState, setListState] = useState<SharedListState>({
    status: "idle",
    message: null,
    withMe: [],
    byMe: [],
  });

  const graphScopes = useMemo(() => getGraphScopes(), []);
  const tokenProvider = useCallback((scopes: string[]) => getAccessToken(scopes), [getAccessToken]);

  const graphClient = useMemo(
    () =>
      createGraphClient({
        accessTokenProvider: tokenProvider,
      }),
    [tokenProvider],
  );

  const oneDrive = useMemo(
    () => createOneDriveService(graphClient, graphScopes),
    [graphClient, graphScopes],
  );

  const loadSharedRoots = useCallback(async () => {
    if (!isSignedIn || !isOnline) {
      return;
    }
    setListState({
      status: "loading",
      message: "Loading shared folders...",
      withMe: [],
      byMe: [],
    });
    try {
      const [withMe, byMe] = await Promise.all([
        oneDrive.listSharedWithMeRoots(),
        oneDrive.listSharedByMeRoots(),
      ]);
      setListState({
        status: "idle",
        message: withMe.length === 0 && byMe.length === 0 ? "No shared folders found yet." : null,
        withMe,
        byMe,
      });
    } catch (err) {
      setListState({ status: "error", message: getUserMessage(err), withMe: [], byMe: [] });
    }
  }, [isOnline, isSignedIn, oneDrive]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSharedRoots();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadSharedRoots]);

  const isBusy = listState.status === "loading";
  const showSignInNotice = !isSignedIn;
  const showOfflineNotice = !isOnline;
  const showEmptyWithMe = isSignedIn && isOnline && !isBusy && listState.withMe.length === 0;
  const showEmptyByMe = isSignedIn && isOnline && !isBusy && listState.byMe.length === 0;

  return (
    <div className="section-stack">
      <section className="app-surface">
        <h1>Shared</h1>
        <p className="app-muted">Select a shared OneDrive folder to access shared data.</p>
        <p className="app-muted">Shared folders must live under /Apps/PiggyBank/shared/.</p>
      </section>

      {selection ? (
        <section className="app-surface">
          <div className="app-muted">Selected shared space</div>
          <div style={{ fontWeight: 600 }}>{selection.name}</div>
          <div className="app-muted">Shared ID: {selection.sharedId}</div>
          <div className="app-actions" style={{ marginTop: 12 }}>
            <Link href={`/shared/${encodeURIComponent(selection.sharedId)}/dashboard`}>
              <Button appearance="primary">Open selected space</Button>
            </Link>
            <Button onClick={clearSelection}>Clear selection</Button>
          </div>
        </section>
      ) : null}

      {showSignInNotice ? (
        <div className="app-alert" role="status">
          <Text>Sign in to load shared folders.</Text>
        </div>
      ) : null}
      {showOfflineNotice ? (
        <div className="app-alert" role="status">
          <Text>Offline mode. Shared folders cannot be loaded.</Text>
        </div>
      ) : null}
      {listState.message ? (
        <div className={`app-alert ${listState.status === "error" ? "app-alert-error" : ""}`}>
          <Text>{listState.message}</Text>
        </div>
      ) : null}

      <section className="app-surface">
        <h2>Shared folders</h2>
        <div className="app-actions" style={{ marginBottom: 12 }}>
          <Button onClick={loadSharedRoots} disabled={!isSignedIn || !isOnline || isBusy}>
            Refresh list
          </Button>
          {isBusy ? <Spinner size="tiny" /> : null}
        </div>
        {listState.withMe.length === 0 && listState.byMe.length === 0 ? (
          <div className="app-muted">No shared folders are available yet.</div>
        ) : null}
        {listState.withMe.length > 0 ? (
          <div className="section-stack">
            <div className="app-muted">Shared with me</div>
            <div className="card-grid">
              {listState.withMe.map((space) => (
                <div key={space.sharedId} className="app-surface">
                  <div style={{ fontWeight: 600 }}>{space.name}</div>
                  <div className="app-muted">Shared ID: {space.sharedId}</div>
                  <div className="app-muted">Editing depends on shared access rights.</div>
                  <div className="app-actions" style={{ marginTop: 12 }}>
                    <Link href={`/shared/${encodeURIComponent(space.sharedId)}/dashboard`}>
                      <Button
                        appearance="primary"
                        onClick={() =>
                          setSelection({
                            sharedId: space.sharedId,
                            driveId: space.driveId,
                            itemId: space.itemId,
                            name: space.name,
                            webUrl: space.webUrl,
                          })
                        }
                      >
                        Open
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : showEmptyWithMe ? (
          <div className="app-muted">No folders shared with you yet.</div>
        ) : null}
        {listState.byMe.length > 0 ? (
          <div className="section-stack" style={{ marginTop: 16 }}>
            <div className="app-muted">Shared by me</div>
            <div className="card-grid">
              {listState.byMe.map((space) => (
                <div key={space.sharedId} className="app-surface">
                  <div style={{ fontWeight: 600 }}>{space.name}</div>
                  <div className="app-muted">Shared ID: {space.sharedId}</div>
                  <div className="app-muted">Editing depends on shared access rights.</div>
                  <div className="app-actions" style={{ marginTop: 12 }}>
                    <Link href={`/shared/${encodeURIComponent(space.sharedId)}/dashboard`}>
                      <Button
                        appearance="primary"
                        onClick={() =>
                          setSelection({
                            sharedId: space.sharedId,
                            driveId: space.driveId,
                            itemId: space.itemId,
                            name: space.name,
                            webUrl: space.webUrl,
                          })
                        }
                      >
                        Open
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : showEmptyByMe ? (
          <div className="app-muted" style={{ marginTop: 16 }}>
            No folders shared by you yet.
          </div>
        ) : null}
      </section>
    </div>
  );
}
