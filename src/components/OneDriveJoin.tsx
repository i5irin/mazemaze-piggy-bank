"use client";

import { Button } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import type { StorageService } from "@/lib/storage/storageService";
import type { SharedRootListItem } from "@/lib/storage/types";
import { isGraphError } from "@/lib/graph/graphErrors";

export function OneDriveJoin({
  storage,
  disabled,
  onJoined,
  selectedId,
  onForgot,
}: {
  storage: StorageService;
  disabled: boolean;
  onJoined: (root: SharedRootListItem) => void;
  selectedId?: string;
  onForgot?: () => void;
}) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const join = async () => {
    if (!storage.joinSharedRootByLink || busy || disabled) return;
    setBusy(true);
    setMessage("");
    try {
      const root = await storage.joinSharedRootByLink(link);
      if (!mounted.current) return;
      setLink("");
      setMessage("Workspace joined and selected. Open Shared to view it.");
      onJoined(root);
    } catch (error) {
      if (mounted.current)
        setMessage(
          `Could not join${isGraphError(error) && error.status ? ` (HTTP ${error.status})` : ""}. Check your account and sharing permission, then ask the owner for a workspace folder link and try again. Also allow local storage to remember it.`,
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const forget = async () => {
    if (!selectedId || !storage.forgetJoinedRoot || disabled || busy) return;
    setBusy(true);
    try {
      await storage.forgetJoinedRoot(selectedId);
      if (!mounted.current) return;
      onForgot?.();
      setMessage(
        "Saved membership removed from this device. Cloud files and sharing permissions were not changed.",
      );
    } catch {
      if (mounted.current)
        setMessage(
          "Could not forget this workspace. Check your account and local storage, then retry.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void join();
      }}
    >
      <label className="app-muted" htmlFor="onedrive-join-link">
        OneDrive workspace link
      </label>
      <input
        id="onedrive-join-link"
        type="url"
        value={link}
        required
        autoComplete="off"
        spellCheck={false}
        disabled={disabled || busy}
        onChange={(event) => setLink(event.target.value)}
        style={{ width: "100%" }}
      />
      <p className="app-muted settings-help-text">
        Ask the owner to share the workspace folder and send its link. Joining accepts the sharing
        invitation and remembers this workspace on this device for your account. Access is checked
        when you open it. On another device, join using the link again.
      </p>
      <Button type="submit" disabled={disabled || busy || !link.trim()}>
        {busy ? "Joining…" : "Join workspace"}
      </Button>
      {selectedId ? (
        <Button type="button" disabled={disabled || busy} onClick={() => void forget()}>
          Forget saved workspace
        </Button>
      ) : null}
      <p role="status">{message}</p>
    </form>
  );
}
