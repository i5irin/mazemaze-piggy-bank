"use client";

import { createGraphClient } from "@/lib/graph/graphClient";
import { GraphError, isGraphError } from "@/lib/graph/graphErrors";
import { parseSnapshot, type Snapshot } from "@/lib/persistence/snapshot";

export const DEFAULT_TEST_FILE_NAME = "pb-test.json";
const ROOT_PROBE_FILE_NAME = ".pb-root.json";
const APP_ROOT_PATH = "/me/drive/special/approot";
const SNAPSHOT_PERSONAL_FILE_NAME = "snapshot-personal.json";
const SNAPSHOT_SHARED_FILE_NAME = "snapshot-shared.json";
const EVENTS_FOLDER_NAME = "events";
const LEASES_FOLDER_NAME = "leases";
const LEASE_FILE_NAME = "lease.json";
const EVENT_FILE_PREFIX = "event-";
const EVENT_FILE_EXTENSION = ".jsonl";
const SHARED_WITH_ME_PATH = "/me/drive/sharedWithMe";
const APP_SHARED_FOLDER_SEGMENT = "/Apps/PiggyBank/shared";

type GraphClient = ReturnType<typeof createGraphClient>;

export type LeaseRecord = {
  holderLabel: string;
  leaseUntil: string;
  updatedAt: string;
};

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

const buildContentPath = (fileName: string) => buildContentPathFromSegments([fileName]);

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

const isLeaseRecord = (value: unknown): value is LeaseRecord =>
  isRecord(value) &&
  isString(value.holderLabel) &&
  isString(value.leaseUntil) &&
  isString(value.updatedAt);

const parseLeaseRecord = (text: string): LeaseRecord => {
  const data = parseJson(text);
  if (!isLeaseRecord(data)) {
    throw new Error("Lease file has an invalid shape.");
  }
  return data;
};

const normalizeDrivePath = (value: string): string => value.replace(/\\/g, "/");

const isUnderSharedRootPath = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = normalizeDrivePath(value);
  return normalized.includes(APP_SHARED_FOLDER_SEGMENT);
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
    const parentPath = isString(parentReference.path) ? parentReference.path : null;
    if (!isUnderSharedRootPath(parentPath)) {
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

const hasWriteRole = (value: unknown): boolean => {
  if (!isRecord(value) || !Array.isArray(value.roles)) {
    return false;
  }
  return value.roles.some((role) => role === "write" || role === "owner");
};

const hasReadOrWriteRole = (value: unknown): boolean => {
  if (!isRecord(value) || !Array.isArray(value.roles)) {
    return false;
  }
  return value.roles.some((role) => role === "read" || role === "write" || role === "owner");
};

export const createOneDriveService = (client: GraphClient, scopes: string[]) => ({
  ensureAppRoot: async () => {
    try {
      return await client.getJson(APP_ROOT_PATH, scopes);
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) {
        const payload = {
          message: "App root initialization file.",
          createdAt: new Date().toISOString(),
        };
        await client.putJson(buildContentPath(ROOT_PROBE_FILE_NAME), payload, scopes);
        return await client.getJson(APP_ROOT_PATH, scopes);
      }
      throw error;
    }
  },
  writeJsonFile: async (fileName: string, data: unknown) =>
    client.putJson(buildContentPath(fileName), data, scopes),
  readJsonFile: async (fileName: string) => {
    const response = await client.getText(buildContentPath(fileName), scopes);
    return parseJson(response);
  },
  readPersonalSnapshot: async (): Promise<{
    snapshot: Snapshot;
    etag: string | null;
    lastModified: string | null;
  }> => {
    const response = await client.getTextWithHeaders(
      buildContentPathFromSegments([SNAPSHOT_PERSONAL_FILE_NAME]),
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
    const response = await client.putJsonWithHeaders(
      buildContentPathFromSegments([SNAPSHOT_PERSONAL_FILE_NAME]),
      snapshot,
      scopes,
      options,
    );
    return {
      etag: getHeaderValue(response.headers, "ETag") ?? extractETag(response.data),
    };
  },
  readPersonalLease: async (): Promise<LeaseRecord | null> => {
    try {
      const response = await client.getText(
        buildContentPathFromSegments([LEASES_FOLDER_NAME, LEASE_FILE_NAME]),
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
    await client.putJson(
      buildContentPathFromSegments([LEASES_FOLDER_NAME, LEASE_FILE_NAME]),
      lease,
      scopes,
    );
  },
  ensureEventsFolder: async () => {
    try {
      await client.getJson(buildItemPathFromSegments([EVENTS_FOLDER_NAME]), scopes);
    } catch (error) {
      if (isGraphError(error) && error.status === 404) {
        try {
          await client.postJson(
            buildChildrenPathFromSegments([]),
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
    try {
      await client.getJson(buildItemPathFromSegments([LEASES_FOLDER_NAME]), scopes);
    } catch (error) {
      if (isGraphError(error) && error.status === 404) {
        try {
          await client.postJson(
            buildChildrenPathFromSegments([]),
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
    try {
      const data = await client.getJson(
        buildChildrenPathFromSegments([EVENTS_FOLDER_NAME]),
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
  writeEventChunk: async (chunkId: number, content: string) => {
    await client.putText(
      buildContentPathFromSegments([
        EVENTS_FOLDER_NAME,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
      ]),
      content,
      scopes,
    );
  },
  readEventChunk: async (chunkId: number): Promise<string> =>
    client.getText(
      buildContentPathFromSegments([
        EVENTS_FOLDER_NAME,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
      ]),
      scopes,
    ),
  listSharedRoots: async (): Promise<SharedRootListItem[]> => {
    const data = await client.getJson(SHARED_WITH_ME_PATH, scopes);
    return parseSharedListItems(data).filter((item) => item.isFolder);
  },
  listSharedWithMeRoots: async (): Promise<SharedRootListItem[]> => {
    const data = await client.getJson(SHARED_WITH_ME_PATH, scopes);
    return parseSharedListItems(data).filter((item) => item.isFolder);
  },
  listSharedByMeRoots: async (): Promise<SharedRootListItem[]> => {
    try {
      const data = await client.getJson(buildChildrenPathFromSegments(["shared"]), scopes);
      const children = parseDriveItems(data).filter((item) => item.isFolder);
      if (children.length === 0) {
        return [];
      }
      const results = await Promise.all(
        children.map(async (item) => {
          const detail = await client.getJson(
            `/me/drive/items/${encodePathSegment(item.id)}?expand=permissions`,
            scopes,
          );
          const permissions =
            isRecord(detail) && Array.isArray(detail.permissions) ? detail.permissions : [];
          const hasShare = permissions.some(hasReadOrWriteRole);
          if (!hasShare) {
            return null;
          }
          const entry: SharedRootListItem = {
            sharedId: encodeSharedId(item.driveId, item.id),
            driveId: item.driveId,
            itemId: item.id,
            name: item.name,
            isFolder: true,
          };
          if (item.webUrl) {
            entry.webUrl = item.webUrl;
          }
          return entry;
        }),
      );
      return results.filter((entry): entry is SharedRootListItem => Boolean(entry));
    } catch (error) {
      if (isGraphError(error) && error.status === 404) {
        return [];
      }
      throw error;
    }
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
  writeSharedEventChunk: async (root: SharedRootReference, chunkId: number, content: string) => {
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
});
