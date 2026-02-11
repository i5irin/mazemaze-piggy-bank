"use client";

import { createGraphClient } from "@/lib/graph/graphClient";
import { isGraphError } from "@/lib/graph/graphErrors";
import { parseSnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import type { LeaseRecord } from "@/lib/storage/lease";

export const DEFAULT_TEST_FILE_NAME = "pb-test.json";
const ROOT_PROBE_FILE_NAME = ".mpb-root.json";
const POINTER_FILE_NAME = ".mpb-pointer.json";
const APP_ROOT_PATH = "/me/drive/special/approot";
const SNAPSHOT_PERSONAL_FILE_NAME = "snapshot-personal.json";
const SNAPSHOT_SHARED_FILE_NAME = "snapshot-shared.json";
const EVENTS_FOLDER_NAME = "events";
const LEASES_FOLDER_NAME = "leases";
const LEASE_FILE_NAME = "lease.json";
const EVENT_FILE_PREFIX = "event-";
const EVENT_FILE_EXTENSION = ".jsonl";
const SHARED_WITH_ME_PATH = "/me/drive/sharedWithMe";
const SHARED_ROOT_FOLDER_NAME = "shared";
const PERSONAL_ROOT_FOLDER_NAME = "personal";
const POINTER_SCHEMA_VERSION = 1;

type GraphClient = ReturnType<typeof createGraphClient>;

export type SharedRootReference = {
  sharedId: string;
  driveId: string;
  itemId: string;
};

export type SharedRootInfo = SharedRootReference & {
  name: string;
  webUrl?: string;
  canWrite: boolean;
  isFolder: boolean;
};

export type SharedRootListItem = SharedRootReference & {
  name: string;
  webUrl?: string;
  isFolder: boolean;
};

type PointerRecord = {
  schemaVersion: number;
  updatedAt: string;
  appRootFolderId?: string;
  personalRootFolderId?: string;
  sharedRootFolderId?: string;
};

export type ShareLinkPermission = "view" | "edit";

export type ShareLinkResult = {
  permission: ShareLinkPermission;
  webUrl: string;
};

const encodeDrivePath = (path: string) => encodeURIComponent(path).replace(/%2F/g, "/");

const buildPathFromSegments = (segments: string[]) => encodeDrivePath(segments.join("/"));

const encodePathSegment = (value: string) => encodeURIComponent(value);

export const encodeSharedId = (driveId: string, itemId: string): string => `${driveId}_${itemId}`;

export const decodeSharedId = (sharedId: string): { driveId: string; itemId: string } | null => {
  const parts = sharedId.split("_");
  if (parts.length !== 2) {
    return null;
  }
  const [driveId, itemId] = parts;
  if (!driveId || !itemId) {
    return null;
  }
  return { driveId, itemId };
};

const buildContentPathFromSegments = (segments: string[]) =>
  `${APP_ROOT_PATH}:/${buildPathFromSegments(segments)}:/content`;

const buildItemPathFromSegments = (segments: string[]) =>
  `${APP_ROOT_PATH}:/${buildPathFromSegments(segments)}`;

const buildChildrenPathFromSegments = (segments: string[]) =>
  segments.length === 0
    ? `${APP_ROOT_PATH}/children`
    : `${APP_ROOT_PATH}:/${buildPathFromSegments(segments)}:/children`;

const buildSharedRootPath = (root: { driveId: string; itemId: string }) =>
  `/drives/${encodePathSegment(root.driveId)}/items/${encodePathSegment(root.itemId)}`;

const buildSharedItemPathFromSegments = (
  root: { driveId: string; itemId: string },
  segments: string[],
) =>
  segments.length === 0
    ? buildSharedRootPath(root)
    : `${buildSharedRootPath(root)}:/${buildPathFromSegments(segments)}`;

const buildSharedContentPathFromSegments = (
  root: { driveId: string; itemId: string },
  segments: string[],
) => `${buildSharedRootPath(root)}:/${buildPathFromSegments(segments)}:/content`;

const buildSharedChildrenPathFromSegments = (
  root: { driveId: string; itemId: string },
  segments: string[],
) =>
  segments.length === 0
    ? `${buildSharedRootPath(root)}/children`
    : `${buildSharedRootPath(root)}:/${buildPathFromSegments(segments)}:/children`;

const getHeaderValue = (headers: Headers, name: string): string | null =>
  headers.get(name) ?? headers.get(name.toLowerCase());

const extractETag = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  return typeof record.eTag === "string" ? record.eTag : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseChildNames = (data: unknown): string[] => {
  if (!isRecord(data)) {
    return [];
  }
  const value = data.value;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (isRecord(item) && typeof item.name === "string" ? item.name : null))
    .filter((name): name is string => Boolean(name));
};

const parseEventChunkId = (fileName: string): number | null => {
  if (!fileName.startsWith(EVENT_FILE_PREFIX) || !fileName.endsWith(EVENT_FILE_EXTENSION)) {
    return null;
  }
  const raw = fileName.slice(EVENT_FILE_PREFIX.length, -EVENT_FILE_EXTENSION.length);
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The file content is not valid JSON.");
  }
};

const isString = (value: unknown): value is string => typeof value === "string";

const isPointerRecord = (value: unknown): value is PointerRecord => {
  if (!isRecord(value)) {
    return false;
  }
  if (!isString(value.updatedAt) || value.schemaVersion !== POINTER_SCHEMA_VERSION) {
    return false;
  }
  if (value.appRootFolderId !== undefined && !isString(value.appRootFolderId)) {
    return false;
  }
  if (value.personalRootFolderId !== undefined && !isString(value.personalRootFolderId)) {
    return false;
  }
  if (value.sharedRootFolderId !== undefined && !isString(value.sharedRootFolderId)) {
    return false;
  }
  return true;
};

const parsePointerRecord = (text: string): PointerRecord => {
  const data = parseJson(text);
  if (!isPointerRecord(data)) {
    throw new Error("Pointer file has an invalid shape.");
  }
  return data;
};

const isLeaseRecord = (value: unknown): value is LeaseRecord => {
  if (
    !isRecord(value) ||
    !isString(value.holderLabel) ||
    !isString(value.leaseUntil) ||
    !isString(value.updatedAt)
  ) {
    return false;
  }
  if (value.deviceId !== undefined && !isString(value.deviceId)) {
    return false;
  }
  return true;
};

const parseLeaseRecord = (text: string): LeaseRecord => {
  const data = parseJson(text);
  if (!isLeaseRecord(data)) {
    throw new Error("Lease file has an invalid shape.");
  }
  return data;
};

const parseSharedListItems = (data: unknown): SharedRootListItem[] => {
  if (!isRecord(data) || !Array.isArray(data.value)) {
    return [];
  }
  const items: SharedRootListItem[] = [];
  for (const entry of data.value) {
    if (!isRecord(entry)) {
      continue;
    }
    const remoteItem = entry.remoteItem;
    if (!isRecord(remoteItem)) {
      continue;
    }
    const parentReference = remoteItem.parentReference;
    if (!isRecord(parentReference)) {
      continue;
    }
    if (!isString(remoteItem.id) || !isString(parentReference.driveId)) {
      continue;
    }
    const name = isString(remoteItem.name)
      ? remoteItem.name
      : isString(entry.name)
        ? entry.name
        : "Shared item";
    const webUrl = isString(remoteItem.webUrl) ? remoteItem.webUrl : undefined;
    const isFolder = isRecord(remoteItem.folder);
    const driveId = parentReference.driveId;
    const itemId = remoteItem.id;
    const item: SharedRootListItem = {
      sharedId: encodeSharedId(driveId, itemId),
      driveId,
      itemId,
      name,
      isFolder,
    };
    if (webUrl) {
      item.webUrl = webUrl;
    }
    items.push(item);
  }
  return items;
};

type DriveItemInfo = {
  id: string;
  driveId: string;
  name: string;
  webUrl?: string;
  isFolder: boolean;
};

const parseDriveItems = (data: unknown): DriveItemInfo[] => {
  if (!isRecord(data) || !Array.isArray(data.value)) {
    return [];
  }
  const items: DriveItemInfo[] = [];
  for (const entry of data.value) {
    if (!isRecord(entry)) {
      continue;
    }
    const parentReference = entry.parentReference;
    if (!isRecord(parentReference)) {
      continue;
    }
    if (!isString(entry.id) || !isString(parentReference.driveId)) {
      continue;
    }
    const name = isString(entry.name) ? entry.name : "Shared item";
    const webUrl = isString(entry.webUrl) ? entry.webUrl : undefined;
    items.push({
      id: entry.id,
      driveId: parentReference.driveId,
      name,
      webUrl,
      isFolder: isRecord(entry.folder),
    });
  }
  return items;
};

const parseDriveItem = (data: unknown, fallbackDriveId?: string): DriveItemInfo | null => {
  if (!isRecord(data) || !isString(data.id)) {
    return null;
  }
  const parentReference = data.parentReference;
  const driveId =
    isRecord(parentReference) && isString(parentReference.driveId)
      ? parentReference.driveId
      : (fallbackDriveId ?? null);
  if (!driveId) {
    return null;
  }
  return {
    id: data.id,
    driveId,
    name: isString(data.name) ? data.name : "Shared item",
    webUrl: isString(data.webUrl) ? data.webUrl : undefined,
    isFolder: isRecord(data.folder),
  };
};

const tryReadFolderById = async (
  client: GraphClient,
  scopes: string[],
  itemId: string,
): Promise<DriveItemInfo | null> => {
  try {
    const data = await client.getJson(`/me/drive/items/${encodePathSegment(itemId)}`, scopes);
    const parsed = parseDriveItem(data);
    return parsed && parsed.isFolder ? parsed : null;
  } catch (error) {
    if (isGraphError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const readPointerRecord = async (
  client: GraphClient,
  scopes: string[],
): Promise<PointerRecord | null> => {
  try {
    const response = await client.getText(
      buildContentPathFromSegments([POINTER_FILE_NAME]),
      scopes,
    );
    return parsePointerRecord(response);
  } catch (error) {
    if (isGraphError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const writePointerRecord = async (
  client: GraphClient,
  scopes: string[],
  record: PointerRecord,
): Promise<void> => {
  await client.putJson(buildContentPathFromSegments([POINTER_FILE_NAME]), record, scopes);
};

const hasWriteRole = (value: unknown): boolean => {
  if (!isRecord(value) || !Array.isArray(value.roles)) {
    return false;
  }
  return value.roles.some((role) => role === "write" || role === "owner");
};

const toSharedRootListItem = (item: DriveItemInfo): SharedRootListItem => ({
  sharedId: encodeSharedId(item.driveId, item.id),
  driveId: item.driveId,
  itemId: item.id,
  name: item.name,
  webUrl: item.webUrl,
  isFolder: item.isFolder,
});

const parseShareLinkWebUrl = (data: unknown): string | null => {
  if (!isRecord(data)) {
    return null;
  }
  const link = data.link;
  if (isRecord(link) && isString(link.webUrl)) {
    return link.webUrl;
  }
  return isString(data.webUrl) ? data.webUrl : null;
};

type EnsureSharedRootFolderOptions = {
  repairConflict?: boolean;
};

const buildSharedConflictName = (): string =>
  `${SHARED_ROOT_FOLDER_NAME}-legacy-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const getPersonalDriveId = async (
  client: GraphClient,
  scopes: string[],
): Promise<string | null> => {
  const drive = await client.getJson("/me/drive", scopes);
  return isRecord(drive) && isString(drive.id) ? drive.id : null;
};

const listAppRootChildren = async (
  client: GraphClient,
  scopes: string[],
): Promise<DriveItemInfo[]> => {
  const data = await client.getJson(buildChildrenPathFromSegments([]), scopes);
  return parseDriveItems(data);
};

const listChildFolders = async (
  client: GraphClient,
  scopes: string[],
  root: { driveId: string; itemId: string },
  name?: string,
): Promise<DriveItemInfo[]> => {
  const data = await client.getJson(buildSharedChildrenPathFromSegments(root, []), scopes);
  const folders = parseDriveItems(data).filter((item) => item.isFolder);
  if (!name) {
    return folders;
  }
  return folders.filter((item) => item.name === name);
};

const hasFileByPath = async (
  client: GraphClient,
  scopes: string[],
  path: string,
): Promise<boolean> => {
  try {
    await client.getJson(path, scopes);
    return true;
  } catch (error) {
    if (isGraphError(error) && error.status === 404) {
      return false;
    }
    throw error;
  }
};

const hasPersonalSnapshot = async (
  client: GraphClient,
  scopes: string[],
  root: { driveId: string; itemId: string },
): Promise<boolean> => {
  try {
    await client.getText(
      buildSharedContentPathFromSegments(root, [SNAPSHOT_PERSONAL_FILE_NAME]),
      scopes,
    );
    return true;
  } catch (error) {
    if (isGraphError(error) && error.status === 404) {
      return false;
    }
    throw error;
  }
};

const hasSharedSnapshot = async (
  client: GraphClient,
  scopes: string[],
  root: { driveId: string; itemId: string },
): Promise<boolean> => {
  try {
    await client.getText(
      buildSharedContentPathFromSegments(root, [SNAPSHOT_SHARED_FILE_NAME]),
      scopes,
    );
    return true;
  } catch (error) {
    if (isGraphError(error) && error.status === 404) {
      return false;
    }
    throw error;
  }
};

const selectBestCandidate = async (
  candidates: DriveItemInfo[],
  scorer: (candidate: DriveItemInfo) => Promise<number>,
): Promise<DriveItemInfo> => {
  if (candidates.length === 1) {
    return candidates[0];
  }
  let best = candidates[0];
  let bestScore = -1;
  const sorted = [...candidates].sort((left, right) => left.id.localeCompare(right.id));
  for (const candidate of sorted) {
    const score = await scorer(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
};

const scorePersonalRootCandidate = async (
  client: GraphClient,
  scopes: string[],
  candidate: DriveItemInfo,
): Promise<number> => {
  let score = 0;
  if (
    await hasPersonalSnapshot(client, scopes, { driveId: candidate.driveId, itemId: candidate.id })
  ) {
    score += 2;
  }
  return score;
};

const scoreSharedRootCandidate = async (
  client: GraphClient,
  scopes: string[],
  candidate: DriveItemInfo,
): Promise<number> => {
  const children = await listChildFolders(client, scopes, {
    driveId: candidate.driveId,
    itemId: candidate.id,
  });
  if (children.length === 0) {
    return 0;
  }
  for (const child of children.slice(0, 5)) {
    if (await hasSharedSnapshot(client, scopes, { driveId: child.driveId, itemId: child.id })) {
      return 2;
    }
  }
  return 1;
};

const resolveSharedRootCandidate = async (
  client: GraphClient,
  scopes: string[],
): Promise<DriveItemInfo | null> => {
  try {
    const existing = await client.getJson(
      buildItemPathFromSegments([SHARED_ROOT_FOLDER_NAME]),
      scopes,
    );
    const direct = parseDriveItem(existing);
    if (direct) {
      return direct;
    }
    const driveId = await getPersonalDriveId(client, scopes);
    if (driveId) {
      const withFallback = parseDriveItem(existing, driveId);
      if (withFallback) {
        return withFallback;
      }
    }
  } catch (error) {
    if (!isGraphError(error) || error.status !== 404) {
      throw error;
    }
  }

  try {
    const entries = await listAppRootChildren(client, scopes);
    const candidates = entries.filter((item) => item.name === SHARED_ROOT_FOLDER_NAME);
    if (candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    return await selectBestCandidate(candidates, (candidate) =>
      scoreSharedRootCandidate(client, scopes, candidate),
    );
  } catch (error) {
    if (!isGraphError(error) || error.status !== 404) {
      throw error;
    }
    return null;
  }
};

const ensureSharedRootFolder = async (
  client: GraphClient,
  scopes: string[],
  options?: EnsureSharedRootFolderOptions,
): Promise<DriveItemInfo> => {
  const existing = await resolveSharedRootCandidate(client, scopes);
  if (existing) {
    if (existing.isFolder) {
      return existing;
    }
    if (options?.repairConflict) {
      await client.patchJson(
        `/me/drive/items/${encodePathSegment(existing.id)}`,
        { name: buildSharedConflictName() },
        scopes,
      );
    } else {
      throw new Error("Shared root is not a folder.");
    }
  }

  try {
    await client.postJson(
      buildChildrenPathFromSegments([]),
      {
        name: SHARED_ROOT_FOLDER_NAME,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      },
      scopes,
    );
  } catch (creationError) {
    if (!isGraphError(creationError) || creationError.status !== 409) {
      throw creationError;
    }
  }

  const resolved = await resolveSharedRootCandidate(client, scopes);
  if (!resolved || !resolved.isFolder) {
    throw new Error("Shared root is not a folder.");
  }
  return resolved;
};

export const createOneDriveService = (client: GraphClient, scopes: string[]) => {
  let pointerPromise: Promise<PointerRecord | null> | null = null;
  let appRootPromise: Promise<DriveItemInfo> | null = null;
  let personalRootPromise: Promise<DriveItemInfo> | null = null;
  let sharedRootPromise: Promise<DriveItemInfo | null> | null = null;
  let rootProbePromise: Promise<void> | null = null;
  let rootProbeRootKey: string | null = null;

  const resetRootCaches = () => {
    pointerPromise = null;
    appRootPromise = null;
    personalRootPromise = null;
    sharedRootPromise = null;
    rootProbePromise = null;
    rootProbeRootKey = null;
  };

  const getPointerRecord = async (): Promise<PointerRecord | null> => {
    if (!pointerPromise) {
      pointerPromise = (async () => {
        try {
          return await readPointerRecord(client, scopes);
        } catch {
          return null;
        }
      })();
    }
    return pointerPromise;
  };

  const updatePointerRecord = async (partial: Partial<PointerRecord>): Promise<PointerRecord> => {
    const base = (await getPointerRecord()) ?? {
      schemaVersion: POINTER_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    const next: PointerRecord = {
      ...base,
      ...partial,
      schemaVersion: POINTER_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    await writePointerRecord(client, scopes, next);
    pointerPromise = Promise.resolve(next);
    return next;
  };

  const getAppRootFolder = async (): Promise<DriveItemInfo> => {
    if (!appRootPromise) {
      appRootPromise = (async () => {
        const pointer = await getPointerRecord();
        if (pointer?.appRootFolderId) {
          const resolved = await tryReadFolderById(client, scopes, pointer.appRootFolderId);
          if (resolved) {
            return resolved;
          }
          await updatePointerRecord({ appRootFolderId: undefined });
        }
        const rootData = await client.getJson(APP_ROOT_PATH, scopes);
        const driveId = await getPersonalDriveId(client, scopes);
        const parsed = parseDriveItem(rootData, driveId ?? undefined);
        if (!parsed || !parsed.isFolder) {
          throw new Error("App root is unavailable.");
        }
        await updatePointerRecord({ appRootFolderId: parsed.id });
        return parsed;
      })();
    }
    return appRootPromise;
  };

  const getPersonalRootFolder = async (): Promise<DriveItemInfo> => {
    if (!personalRootPromise) {
      personalRootPromise = (async () => {
        const pointer = await getPointerRecord();
        if (pointer?.personalRootFolderId) {
          const resolved = await tryReadFolderById(client, scopes, pointer.personalRootFolderId);
          if (resolved) {
            return resolved;
          }
          await updatePointerRecord({ personalRootFolderId: undefined });
        }
        const appRoot = await getAppRootFolder();
        const appRootRef = { driveId: appRoot.driveId, itemId: appRoot.id };
        const candidates = await listChildFolders(
          client,
          scopes,
          appRootRef,
          PERSONAL_ROOT_FOLDER_NAME,
        );
        let resolved: DriveItemInfo;
        if (candidates.length === 0) {
          const created = await client.postJson(
            buildSharedChildrenPathFromSegments(appRootRef, []),
            {
              name: PERSONAL_ROOT_FOLDER_NAME,
              folder: {},
              "@microsoft.graph.conflictBehavior": "fail",
            },
            scopes,
          );
          const parsed = parseDriveItem(created, appRoot.driveId);
          if (!parsed || !parsed.isFolder) {
            throw new Error("Failed to create personal folder.");
          }
          resolved = parsed;
        } else if (candidates.length === 1) {
          resolved = candidates[0];
        } else {
          resolved = await selectBestCandidate(candidates, (candidate) =>
            scorePersonalRootCandidate(client, scopes, candidate),
          );
        }
        await updatePointerRecord({
          appRootFolderId: appRoot.id,
          personalRootFolderId: resolved.id,
        });
        return resolved;
      })();
    }
    return personalRootPromise;
  };

  const getSharedRootFolder = async (options?: {
    createIfMissing?: boolean;
  }): Promise<DriveItemInfo | null> => {
    if (!sharedRootPromise) {
      sharedRootPromise = (async () => {
        const pointer = await getPointerRecord();
        if (pointer?.sharedRootFolderId) {
          const resolved = await tryReadFolderById(client, scopes, pointer.sharedRootFolderId);
          if (resolved) {
            return resolved;
          }
          await updatePointerRecord({ sharedRootFolderId: undefined });
        }
        const candidate = await resolveSharedRootCandidate(client, scopes);
        if (candidate && candidate.isFolder) {
          await updatePointerRecord({
            sharedRootFolderId: candidate.id,
            appRootFolderId: (await getAppRootFolder()).id,
          });
          return candidate;
        }
        if (!options?.createIfMissing) {
          return null;
        }
        const created = await ensureSharedRootFolder(client, scopes, { repairConflict: true });
        if (created.isFolder) {
          await updatePointerRecord({
            sharedRootFolderId: created.id,
            appRootFolderId: (await getAppRootFolder()).id,
          });
          return created;
        }
        return null;
      })();
    }
    return sharedRootPromise;
  };

  const getPersonalRootReference = async (): Promise<{ driveId: string; itemId: string }> => {
    const root = await getPersonalRootFolder();
    return { driveId: root.driveId, itemId: root.id };
  };

  const ensureRootProbe = async (root: { driveId: string; itemId: string }) => {
    const rootKey = `${root.driveId}:${root.itemId}`;
    if (rootProbePromise && rootProbeRootKey === rootKey) {
      return rootProbePromise;
    }
    rootProbeRootKey = rootKey;
    rootProbePromise = (async () => {
      const probePath = buildSharedItemPathFromSegments(root, [ROOT_PROBE_FILE_NAME]);
      if (await hasFileByPath(client, scopes, probePath)) {
        return;
      }
      const payload = {
        message: "App root initialization file.",
        createdAt: new Date().toISOString(),
      };
      await client.putJson(
        buildSharedContentPathFromSegments(root, [ROOT_PROBE_FILE_NAME]),
        payload,
        scopes,
      );
    })().catch((error) => {
      if (rootProbeRootKey === rootKey) {
        rootProbePromise = null;
        rootProbeRootKey = null;
      }
      throw error;
    });
    return rootProbePromise;
  };

  return {
    ensureAppRoot: async () => {
      const root = await getAppRootFolder();
      await ensureRootProbe({ driveId: root.driveId, itemId: root.id });
      await getPersonalRootFolder();
      return root;
    },
    writeJsonFile: async (fileName: string, data: unknown) => {
      const personal = await getPersonalRootReference();
      await client.putJson(buildSharedContentPathFromSegments(personal, [fileName]), data, scopes);
    },
    readJsonFile: async (fileName: string) => {
      const personal = await getPersonalRootReference();
      const response = await client.getText(
        buildSharedContentPathFromSegments(personal, [fileName]),
        scopes,
      );
      return parseJson(response);
    },
    readPersonalSnapshot: async (): Promise<{
      snapshot: Snapshot;
      etag: string | null;
      lastModified: string | null;
    }> => {
      const personal = await getPersonalRootReference();
      const response = await client.getTextWithHeaders(
        buildSharedContentPathFromSegments(personal, [SNAPSHOT_PERSONAL_FILE_NAME]),
        scopes,
      );
      const snapshot = parseSnapshot(response.data);
      return {
        snapshot,
        etag: getHeaderValue(response.headers, "ETag"),
        lastModified: getHeaderValue(response.headers, "Last-Modified"),
      };
    },
    writePersonalSnapshot: async (
      snapshot: Snapshot,
      options?: { ifMatch?: string },
    ): Promise<{ etag: string | null }> => {
      const personal = await getPersonalRootReference();
      const response = await client.putJsonWithHeaders(
        buildSharedContentPathFromSegments(personal, [SNAPSHOT_PERSONAL_FILE_NAME]),
        snapshot,
        scopes,
        options,
      );
      return {
        etag: getHeaderValue(response.headers, "ETag") ?? extractETag(response.data),
      };
    },
    readPersonalLease: async (): Promise<LeaseRecord | null> => {
      const personal = await getPersonalRootReference();
      try {
        const response = await client.getText(
          buildSharedContentPathFromSegments(personal, [LEASES_FOLDER_NAME, LEASE_FILE_NAME]),
          scopes,
        );
        return parseLeaseRecord(response);
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    writePersonalLease: async (lease: LeaseRecord) => {
      const personal = await getPersonalRootReference();
      await client.putJson(
        buildSharedContentPathFromSegments(personal, [LEASES_FOLDER_NAME, LEASE_FILE_NAME]),
        lease,
        scopes,
      );
    },
    ensureEventsFolder: async () => {
      const personal = await getPersonalRootReference();
      try {
        await client.getJson(
          buildSharedItemPathFromSegments(personal, [EVENTS_FOLDER_NAME]),
          scopes,
        );
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          try {
            await client.postJson(
              buildSharedChildrenPathFromSegments(personal, []),
              {
                name: EVENTS_FOLDER_NAME,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              },
              scopes,
            );
          } catch (creationError) {
            if (isGraphError(creationError) && creationError.status === 409) {
              return;
            }
            throw creationError;
          }
          return;
        }
        throw error;
      }
    },
    ensureLeasesFolder: async () => {
      const personal = await getPersonalRootReference();
      try {
        await client.getJson(
          buildSharedItemPathFromSegments(personal, [LEASES_FOLDER_NAME]),
          scopes,
        );
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          try {
            await client.postJson(
              buildSharedChildrenPathFromSegments(personal, []),
              {
                name: LEASES_FOLDER_NAME,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              },
              scopes,
            );
          } catch (creationError) {
            if (isGraphError(creationError) && creationError.status === 409) {
              return;
            }
            throw creationError;
          }
          return;
        }
        throw error;
      }
    },
    listEventChunkIds: async (): Promise<number[]> => {
      const personal = await getPersonalRootReference();
      try {
        const data = await client.getJson(
          buildSharedChildrenPathFromSegments(personal, [EVENTS_FOLDER_NAME]),
          scopes,
        );
        const names = parseChildNames(data);
        return names
          .map(parseEventChunkId)
          .filter((value): value is number => typeof value === "number");
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return [];
        }
        throw error;
      }
    },
    writeEventChunk: async (
      chunkId: number,
      content: string,
      _options?: { assumeMissing?: boolean },
    ) => {
      void _options;
      const personal = await getPersonalRootReference();
      await client.putText(
        buildSharedContentPathFromSegments(personal, [
          EVENTS_FOLDER_NAME,
          `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
        ]),
        content,
        scopes,
      );
    },
    readEventChunk: async (chunkId: number): Promise<string> => {
      const personal = await getPersonalRootReference();
      return client.getText(
        buildSharedContentPathFromSegments(personal, [
          EVENTS_FOLDER_NAME,
          `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
        ]),
        scopes,
      );
    },
    deleteEventChunk: async (chunkId: number) => {
      const personal = await getPersonalRootReference();
      try {
        await client.delete(
          buildSharedItemPathFromSegments(personal, [
            EVENTS_FOLDER_NAME,
            `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
          ]),
          scopes,
        );
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return;
        }
        throw error;
      }
    },
    deleteAllEventChunks: async () => {
      const personal = await getPersonalRootReference();
      try {
        const data = await client.getJson(
          buildSharedChildrenPathFromSegments(personal, [EVENTS_FOLDER_NAME]),
          scopes,
        );
        const names = parseChildNames(data);
        const chunkIds = names
          .map(parseEventChunkId)
          .filter((value): value is number => typeof value === "number");
        await Promise.all(
          chunkIds.map((chunkId) =>
            client
              .delete(
                buildSharedItemPathFromSegments(personal, [
                  EVENTS_FOLDER_NAME,
                  `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
                ]),
                scopes,
              )
              .catch((error) => {
                if (isGraphError(error) && error.status === 404) {
                  return;
                }
                throw error;
              }),
          ),
        );
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return;
        }
        throw error;
      }
    },
    ensureSharedRootFolder: async (): Promise<SharedRootListItem> => {
      const folder = await getSharedRootFolder({ createIfMissing: true });
      if (!folder || !folder.isFolder) {
        throw new Error("Shared root is unavailable.");
      }
      return toSharedRootListItem(folder);
    },
    createSharedFolder: async (name: string): Promise<SharedRootListItem> => {
      const normalized = name.trim();
      if (!normalized) {
        throw new Error("Folder name is required.");
      }
      const sharedRoot = await getSharedRootFolder({ createIfMissing: true });
      if (!sharedRoot || !sharedRoot.isFolder) {
        throw new Error("Shared root is unavailable.");
      }
      const sharedRootRef = { driveId: sharedRoot.driveId, itemId: sharedRoot.id };
      try {
        const created = await client.postJson(
          buildSharedChildrenPathFromSegments(sharedRootRef, []),
          {
            name: normalized,
            folder: {},
            "@microsoft.graph.conflictBehavior": "fail",
          },
          scopes,
        );
        const parsed = parseDriveItem(created, sharedRoot.driveId);
        if (parsed && parsed.isFolder) {
          return toSharedRootListItem(parsed);
        }
      } catch (creationError) {
        if (!isGraphError(creationError) || creationError.status !== 409) {
          throw creationError;
        }
      }
      const fallback = await listChildFolders(client, scopes, sharedRootRef, normalized);
      if (fallback.length > 0) {
        return toSharedRootListItem(fallback[0]);
      }
      throw new Error("Failed to create shared workspace.");
    },
    createShareLink: async (
      root: SharedRootReference,
      permission: ShareLinkPermission,
    ): Promise<ShareLinkResult> => {
      const path = `${buildSharedRootPath(root)}/createLink`;
      let response: unknown;
      try {
        response = await client.postJson(
          path,
          {
            type: permission,
            scope: "anonymous",
          },
          scopes,
        );
      } catch (error) {
        if (!isGraphError(error) || error.status !== 400) {
          throw error;
        }
        response = await client.postJson(
          path,
          {
            type: permission,
          },
          scopes,
        );
      }
      const webUrl = parseShareLinkWebUrl(response);
      if (!webUrl) {
        throw new Error("Share link is unavailable.");
      }
      return {
        permission,
        webUrl,
      };
    },
    deleteAppCloudData: async () => {
      try {
        const root = await client.getJson(APP_ROOT_PATH, scopes);
        if (!isRecord(root) || !isString(root.id)) {
          return;
        }
        await client.delete(`/me/drive/items/${encodePathSegment(root.id)}`, scopes);
        resetRootCaches();
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          resetRootCaches();
          return;
        }
        throw error;
      }
    },
    listSharedWithMeRoots: async (): Promise<SharedRootListItem[]> => {
      const data = await client.getJson(SHARED_WITH_ME_PATH, scopes);
      const candidates = parseSharedListItems(data).filter((item) => item.isFolder);
      const filtered: SharedRootListItem[] = [];
      for (const candidate of candidates) {
        if (
          await hasSharedSnapshot(client, scopes, {
            driveId: candidate.driveId,
            itemId: candidate.itemId,
          })
        ) {
          filtered.push(candidate);
        }
      }
      return filtered;
    },
    listSharedByMeRoots: async (): Promise<SharedRootListItem[]> => {
      const sharedRoot = await getSharedRootFolder({ createIfMissing: false });
      if (!sharedRoot || !sharedRoot.isFolder) {
        return [];
      }
      const data = await client.getJson(
        buildSharedChildrenPathFromSegments(
          { driveId: sharedRoot.driveId, itemId: sharedRoot.id },
          [],
        ),
        scopes,
      );
      return parseDriveItems(data)
        .filter((item) => item.isFolder)
        .map((item) => toSharedRootListItem(item));
    },
    getSharedRootInfo: async (root: SharedRootReference): Promise<SharedRootInfo> => {
      const data = await client.getJson(`${buildSharedRootPath(root)}?expand=permissions`, scopes);
      const name = isRecord(data) && isString(data.name) ? data.name : "Shared item";
      const webUrl = isRecord(data) && isString(data.webUrl) ? data.webUrl : undefined;
      const isFolder = isRecord(data) && isRecord(data.folder);
      const permissions = isRecord(data) && Array.isArray(data.permissions) ? data.permissions : [];
      const canWrite = permissions.some(hasWriteRole);
      return {
        sharedId: root.sharedId,
        driveId: root.driveId,
        itemId: root.itemId,
        name,
        webUrl,
        isFolder,
        canWrite,
      };
    },
    readSharedSnapshot: async (
      root: SharedRootReference,
    ): Promise<{
      snapshot: Snapshot;
      etag: string | null;
      lastModified: string | null;
    }> => {
      const response = await client.getTextWithHeaders(
        buildSharedContentPathFromSegments(root, [SNAPSHOT_SHARED_FILE_NAME]),
        scopes,
      );
      const snapshot = parseSnapshot(response.data);
      return {
        snapshot,
        etag: getHeaderValue(response.headers, "ETag"),
        lastModified: getHeaderValue(response.headers, "Last-Modified"),
      };
    },
    writeSharedSnapshot: async (
      root: SharedRootReference,
      snapshot: Snapshot,
      options?: { ifMatch?: string },
    ): Promise<{ etag: string | null }> => {
      const response = await client.putJsonWithHeaders(
        buildSharedContentPathFromSegments(root, [SNAPSHOT_SHARED_FILE_NAME]),
        snapshot,
        scopes,
        options,
      );
      return {
        etag: getHeaderValue(response.headers, "ETag") ?? extractETag(response.data),
      };
    },
    ensureSharedEventsFolder: async (root: SharedRootReference) => {
      try {
        await client.getJson(buildSharedItemPathFromSegments(root, [EVENTS_FOLDER_NAME]), scopes);
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          try {
            await client.postJson(
              buildSharedChildrenPathFromSegments(root, []),
              {
                name: EVENTS_FOLDER_NAME,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              },
              scopes,
            );
          } catch (creationError) {
            if (isGraphError(creationError) && creationError.status === 409) {
              return;
            }
            throw creationError;
          }
          return;
        }
        throw error;
      }
    },
    ensureSharedLeasesFolder: async (root: SharedRootReference) => {
      try {
        await client.getJson(buildSharedItemPathFromSegments(root, [LEASES_FOLDER_NAME]), scopes);
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          try {
            await client.postJson(
              buildSharedChildrenPathFromSegments(root, []),
              {
                name: LEASES_FOLDER_NAME,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
              },
              scopes,
            );
          } catch (creationError) {
            if (isGraphError(creationError) && creationError.status === 409) {
              return;
            }
            throw creationError;
          }
          return;
        }
        throw error;
      }
    },
    listSharedEventChunkIds: async (root: SharedRootReference): Promise<number[]> => {
      try {
        const data = await client.getJson(
          buildSharedChildrenPathFromSegments(root, [EVENTS_FOLDER_NAME]),
          scopes,
        );
        const names = parseChildNames(data);
        return names
          .map(parseEventChunkId)
          .filter((value): value is number => typeof value === "number");
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return [];
        }
        throw error;
      }
    },
    writeSharedEventChunk: async (
      root: SharedRootReference,
      chunkId: number,
      content: string,
      _options?: { assumeMissing?: boolean },
    ) => {
      void _options;
      await client.putText(
        buildSharedContentPathFromSegments(root, [
          EVENTS_FOLDER_NAME,
          `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
        ]),
        content,
        scopes,
      );
    },
    readSharedEventChunk: async (root: SharedRootReference, chunkId: number): Promise<string> =>
      client.getText(
        buildSharedContentPathFromSegments(root, [
          EVENTS_FOLDER_NAME,
          `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
        ]),
        scopes,
      ),
    deleteSharedEventChunk: async (root: SharedRootReference, chunkId: number) => {
      try {
        await client.delete(
          buildSharedItemPathFromSegments(root, [
            EVENTS_FOLDER_NAME,
            `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
          ]),
          scopes,
        );
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return;
        }
        throw error;
      }
    },
    deleteAllSharedEventChunks: async (root: SharedRootReference) => {
      try {
        const data = await client.getJson(
          buildSharedChildrenPathFromSegments(root, [EVENTS_FOLDER_NAME]),
          scopes,
        );
        const names = parseChildNames(data);
        const chunkIds = names
          .map(parseEventChunkId)
          .filter((value): value is number => typeof value === "number");
        await Promise.all(
          chunkIds.map((chunkId) =>
            client
              .delete(
                buildSharedItemPathFromSegments(root, [
                  EVENTS_FOLDER_NAME,
                  `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
                ]),
                scopes,
              )
              .catch((error) => {
                if (isGraphError(error) && error.status === 404) {
                  return;
                }
                throw error;
              }),
          ),
        );
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return;
        }
        throw error;
      }
    },
    readSharedLease: async (root: SharedRootReference): Promise<LeaseRecord | null> => {
      try {
        const response = await client.getText(
          buildSharedContentPathFromSegments(root, [LEASES_FOLDER_NAME, LEASE_FILE_NAME]),
          scopes,
        );
        return parseLeaseRecord(response);
      } catch (error) {
        if (isGraphError(error) && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    writeSharedLease: async (root: SharedRootReference, lease: LeaseRecord) => {
      await client.putJson(
        buildSharedContentPathFromSegments(root, [LEASES_FOLDER_NAME, LEASE_FILE_NAME]),
        lease,
        scopes,
      );
    },
    getRootFolderInfo: async (): Promise<{
      appRoot?: { id: string; name: string };
      personalRoot?: { id: string; name: string };
      sharedRoot?: { id: string; name: string };
    }> => {
      const pointer = await getPointerRecord();
      const result: {
        appRoot?: { id: string; name: string };
        personalRoot?: { id: string; name: string };
        sharedRoot?: { id: string; name: string };
      } = {};
      if (pointer?.appRootFolderId) {
        const info = await tryReadFolderById(client, scopes, pointer.appRootFolderId);
        if (info) {
          result.appRoot = { id: info.id, name: info.name };
        }
      }
      if (pointer?.personalRootFolderId) {
        const info = await tryReadFolderById(client, scopes, pointer.personalRootFolderId);
        if (info) {
          result.personalRoot = { id: info.id, name: info.name };
        }
      }
      if (pointer?.sharedRootFolderId) {
        const info = await tryReadFolderById(client, scopes, pointer.sharedRootFolderId);
        if (info) {
          result.sharedRoot = { id: info.id, name: info.name };
        }
      }
      return result;
    },
  };
};
