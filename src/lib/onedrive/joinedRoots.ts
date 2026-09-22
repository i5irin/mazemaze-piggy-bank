import type { SharedRootListItem } from "./oneDriveService";

export const JOINED_ROOTS_PREFIX = "mazemaze-onedrive-joined-roots-v1:";
export const JOINED_ROOTS_CHANGED = "mazemaze-joined-roots-changed";

const key = (accountId: string) => `${JOINED_ROOTS_PREFIX}${encodeURIComponent(accountId)}`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function readJoinedRoots(accountId: string): SharedRootListItem[] {
  const raw = window.localStorage.getItem(key(accountId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Saved workspaces are invalid. Rejoin using a link.");
  return parsed.map((item: unknown) => {
    if (
      !isRecord(item) ||
      typeof item.driveId !== "string" ||
      !item.driveId ||
      typeof item.itemId !== "string" ||
      !item.itemId ||
      typeof item.name !== "string" ||
      item.sharedId !== `${item.driveId}_${item.itemId}` ||
      item.isFolder !== true
    )
      throw new Error("Saved workspaces are invalid. Rejoin using a link.");
    return {
      sharedId: item.sharedId as string,
      driveId: item.driveId,
      itemId: item.itemId,
      name: item.name,
      isFolder: true,
    };
  });
}

export function rememberJoinedRoot(accountId: string, root: SharedRootListItem) {
  const roots = readJoinedRoots(accountId).filter((item) => item.sharedId !== root.sharedId);
  // Persist identifiers and display names, never a sharing URL or access credential.
  roots.push({
    sharedId: root.sharedId,
    driveId: root.driveId,
    itemId: root.itemId,
    name: root.name,
    isFolder: true,
  });
  window.localStorage.setItem(key(accountId), JSON.stringify(roots));
  window.dispatchEvent(new Event(JOINED_ROOTS_CHANGED));
}

export function forgetJoinedRoot(accountId: string, sharedId: string) {
  const roots = readJoinedRoots(accountId).filter((item) => item.sharedId !== sharedId);
  window.localStorage.setItem(key(accountId), JSON.stringify(roots));
  window.dispatchEvent(new Event(JOINED_ROOTS_CHANGED));
}

export function encodeOneDriveSharingUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid OneDrive sharing link.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["1drv.ms", "onedrive.live.com"].includes(url.hostname)
  )
    throw new Error("Use an HTTPS sharing link from personal OneDrive.");
  const bytes = new TextEncoder().encode(url.href);
  return `u!${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}
