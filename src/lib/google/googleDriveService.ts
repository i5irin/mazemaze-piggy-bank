"use client";

import { createGoogleDriveClient, buildMultipartBody } from "@/lib/google/googleDriveClient";
import { GoogleDriveError, isGoogleDriveError } from "@/lib/google/googleDriveErrors";
import { getGoogleDriveAppRoot } from "@/lib/auth/googleConfig";
import { parseSnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import type { LeaseRecord } from "@/lib/storage/lease";

const ROOT_PROBE_FILE_NAME = ".mpb-root.json";
const POINTER_FILE_NAME = ".mpb-pointer.json";
const SNAPSHOT_PERSONAL_FILE_NAME = "snapshot-personal.json";
const SNAPSHOT_SHARED_FILE_NAME = "snapshot-shared.json";
const EVENTS_FOLDER_NAME = "events";
const LEASES_FOLDER_NAME = "leases";
const LEASE_FILE_NAME = "lease.json";
const EVENT_FILE_PREFIX = "event-";
const EVENT_FILE_EXTENSION = ".jsonl";
const SHARED_ROOT_FOLDER_NAME = "shared";
const PERSONAL_ROOT_FOLDER_NAME = "personal";
const POINTER_SCHEMA_VERSION = 1;

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  trashed?: boolean;
  modifiedTime?: string;
  etag?: string;
  version?: string;
  webViewLink?: string;
  driveId?: string;
  capabilities?: {
    canEdit?: boolean;
  };
};

type DriveListResponse = {
  files: DriveFile[];
};

type PointerRecord = {
  schemaVersion: number;
  updatedAt: string;
  appRootFolderId?: string;
  personalRootFolderId?: string;
  sharedRootFolderId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The file content is not valid JSON.");
  }
};

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

const normalizeDrivePath = (value: string): string => value.replace(/\\/g, "/");

const splitPathSegments = (value: string): string[] => {
  const normalized = normalizeDrivePath(value).trim();
  if (!normalized) {
    return [];
  }
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const cleaned = trimmed.replace(/\/+$/, "");
  const segments = cleaned
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return [];
  }
  if (segments[0].toLowerCase() === "my drive") {
    return segments.slice(1);
  }
  return segments;
};

const encodeQuery = (value: string) => value.replace(/'/g, "\\'");

const buildListQuery = (parts: string[]): string => parts.join(" and ");

const parseEventChunkId = (fileName: string): number | null => {
  if (!fileName.startsWith(EVENT_FILE_PREFIX) || !fileName.endsWith(EVENT_FILE_EXTENSION)) {
    return null;
  }
  const raw = fileName.slice(EVENT_FILE_PREFIX.length, -EVENT_FILE_EXTENSION.length);
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
};

const isFolder = (file: DriveFile): boolean =>
  file.mimeType === "application/vnd.google-apps.folder";

const toLeaseRecord = (text: string): LeaseRecord => {
  const data = parseJson(text);
  if (!isRecord(data)) {
    throw new Error("Lease file has an invalid shape.");
  }
  if (!isString(data.holderLabel) || !isString(data.leaseUntil) || !isString(data.updatedAt)) {
    throw new Error("Lease file has an invalid shape.");
  }
  if (data.deviceId !== undefined && !isString(data.deviceId)) {
    throw new Error("Lease file has an invalid shape.");
  }
  return {
    holderLabel: data.holderLabel,
    deviceId: data.deviceId,
    leaseUntil: data.leaseUntil,
    updatedAt: data.updatedAt,
  };
};

export type SharedRootReference = {
  sharedId: string;
  fileId: string;
  driveId?: string;
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

export type ShareLinkPermission = "view" | "edit";

export type ShareLinkResult = {
  permission: ShareLinkPermission;
  webUrl: string;
};

type DriveClient = ReturnType<typeof createGoogleDriveClient>;

const DRIVE_FIELDS =
  "files(id,name,mimeType,trashed,modifiedTime,webViewLink,driveId,capabilities(canEdit))";
const CREATE_FOLDER_FIELDS = "id,name,mimeType,trashed,driveId,webViewLink,capabilities(canEdit)";

const ensureDriveId = (id: string | undefined, context: string): string => {
  if (!id) {
    throw new Error(`Google Drive returned an item without an id (${context}).`);
  }
  return id;
};

const ensureFolderByName = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  name: string,
): Promise<DriveFile> => {
  if (!parentId) {
    throw new Error("Missing parent folder id.");
  }
  const query = buildListQuery([
    `'${encodeQuery(parentId)}' in parents`,
    `name='${encodeQuery(name)}'`,
    "trashed=false",
  ]);
  const data = (await client.getJson("/files", scopes, {
    q: query,
    fields: DRIVE_FIELDS,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  })) as DriveListResponse;
  const existing = data.files?.find((file) => isFolder(file));
  if (existing) {
    ensureDriveId(existing.id, "existing folder");
    return existing;
  }
  const created = (await client.postJson(
    `/files?supportsAllDrives=true&fields=${encodeQuery(CREATE_FOLDER_FIELDS)}`,
    {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    scopes,
  )) as unknown as DriveFile;
  ensureDriveId(created.id, "created folder");
  return created;
};

const listFoldersByName = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  name: string,
): Promise<DriveFile[]> => {
  const query = buildListQuery([
    `'${encodeQuery(parentId)}' in parents`,
    `name='${encodeQuery(name)}'`,
    "trashed=false",
  ]);
  const data = (await client.getJson("/files", scopes, {
    q: query,
    fields: DRIVE_FIELDS,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    pageSize: "1000",
  })) as DriveListResponse;
  return (data.files ?? []).filter((file) => isFolder(file));
};

const createFolder = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  name: string,
): Promise<DriveFile> => {
  const created = (await client.postJson(
    `/files?supportsAllDrives=true&fields=${encodeQuery(CREATE_FOLDER_FIELDS)}`,
    {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    scopes,
  )) as unknown as DriveFile;
  ensureDriveId(created.id, "created folder");
  return created;
};

const ensureAppRootFolder = async (client: DriveClient, scopes: string[]): Promise<DriveFile> => {
  const segments = splitPathSegments(getGoogleDriveAppRoot());
  let parentId = "root";
  let current: DriveFile | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    const candidates = await listFoldersByName(client, scopes, parentId, segment);
    if (candidates.length === 0) {
      current = await createFolder(client, scopes, parentId, segment);
    } else if (candidates.length === 1 || !isLast) {
      current = candidates[0];
    } else {
      current = await selectBestCandidate(candidates, (candidate) =>
        scoreAppRootCandidate(client, scopes, candidate),
      );
    }
    parentId = current.id;
  }
  if (!current) {
    current = await ensureFolderByName(client, scopes, parentId, "MazemazePiggyBank");
  }
  return current;
};

const findChildByName = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  name: string,
): Promise<DriveFile | null> => {
  const query = buildListQuery([
    `'${encodeQuery(parentId)}' in parents`,
    `name='${encodeQuery(name)}'`,
    "trashed=false",
  ]);
  const data = (await client.getJson("/files", scopes, {
    q: query,
    fields: DRIVE_FIELDS,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  })) as DriveListResponse;
  return data.files?.[0] ?? null;
};

const listChildren = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  extraQuery?: string,
): Promise<DriveFile[]> => {
  const queryParts = [`'${encodeQuery(parentId)}' in parents`, "trashed=false"];
  if (extraQuery) {
    queryParts.push(extraQuery);
  }
  const data = (await client.getJson("/files", scopes, {
    q: buildListQuery(queryParts),
    fields: DRIVE_FIELDS,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    pageSize: "1000",
  })) as DriveListResponse;
  return data.files ?? [];
};

const listAppDataFilesByName = async (
  client: DriveClient,
  scopes: string[],
  name: string,
): Promise<DriveFile[]> => {
  const query = buildListQuery([`name='${encodeQuery(name)}'`, "trashed=false"]);
  const data = (await client.getJson("/files", scopes, {
    q: query,
    spaces: "appDataFolder",
    fields: DRIVE_FIELDS,
    pageSize: "1000",
  })) as DriveListResponse;
  return data.files ?? [];
};

const readFileText = async (client: DriveClient, scopes: string[], fileId: string) =>
  client.getText(`/files/${encodeQuery(fileId)}?alt=media&supportsAllDrives=true`, scopes);

const readFileMetadata = async (client: DriveClient, scopes: string[], fileId: string) => {
  const { data, headers } = await client.getJsonWithHeaders(
    `/files/${encodeQuery(fileId)}`,
    scopes,
    {
      fields:
        "id,name,modifiedTime,webViewLink,mimeType,driveId,capabilities(canEdit),trashed,version",
      supportsAllDrives: "true",
    },
  );
  const metadata = data as DriveFile;
  const etag = headers.get("etag");
  const versionTag =
    typeof metadata.version === "string" && metadata.version.trim().length > 0
      ? `v${metadata.version}`
      : null;
  return {
    ...metadata,
    etag: etag ?? metadata.etag ?? versionTag ?? undefined,
  } as DriveFile;
};

const tryReadFolderById = async (
  client: DriveClient,
  scopes: string[],
  fileId: string,
): Promise<DriveFile | null> => {
  try {
    const info = (await readFileMetadata(client, scopes, fileId)) as DriveFile;
    if (!isFolder(info) || info.trashed) {
      return null;
    }
    return info;
  } catch (error) {
    if (isGoogleDriveError(error) && error.code === "not_found") {
      return null;
    }
    throw error;
  }
};

const ensureFileEtag = async (
  client: DriveClient,
  scopes: string[],
  file: DriveFile,
): Promise<DriveFile> => {
  if (file.etag) {
    return file;
  }
  const fetched = await readFileMetadata(client, scopes, file.id);
  if (fetched.etag) {
    return fetched;
  }
  if (fetched.version) {
    return { ...fetched, etag: `v${fetched.version}` };
  }
  return fetched;
};

const readPointerRecord = async (
  client: DriveClient,
  scopes: string[],
): Promise<PointerRecord | null> => {
  const files = await listAppDataFilesByName(client, scopes, POINTER_FILE_NAME);
  const file = files.find((item) => !item.trashed) ?? files[0];
  if (!file) {
    return null;
  }
  const content = await readFileText(client, scopes, file.id);
  return parsePointerRecord(content);
};

const writePointerRecord = async (
  client: DriveClient,
  scopes: string[],
  record: PointerRecord,
): Promise<void> => {
  const existing = await listAppDataFilesByName(client, scopes, POINTER_FILE_NAME);
  const file = existing[0];
  if (file) {
    await client.uploadMedia(
      `/files/${encodeQuery(file.id)}?uploadType=media`,
      "application/json",
      JSON.stringify(record),
      scopes,
    );
    return;
  }
  const metadata = {
    name: POINTER_FILE_NAME,
    parents: ["appDataFolder"],
  };
  const body = buildMultipartBody(metadata, "application/json", JSON.stringify(record));
  await client.uploadMultipart("/files?uploadType=multipart", body, scopes);
};

const deletePointerRecord = async (client: DriveClient, scopes: string[]): Promise<void> => {
  const files = await listAppDataFilesByName(client, scopes, POINTER_FILE_NAME);
  const file = files[0];
  if (!file) {
    return;
  }
  await client.delete(`/files/${encodeQuery(file.id)}`, scopes);
};

const selectBestCandidate = async (
  candidates: DriveFile[],
  scorer: (candidate: DriveFile) => Promise<number>,
): Promise<DriveFile> => {
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

const scoreAppRootCandidate = async (
  client: DriveClient,
  scopes: string[],
  candidate: DriveFile,
): Promise<number> => {
  let score = 0;
  const probe = await findChildByName(client, scopes, candidate.id, ROOT_PROBE_FILE_NAME);
  if (probe) {
    score += 2;
  }
  const personal = await findChildByName(client, scopes, candidate.id, PERSONAL_ROOT_FOLDER_NAME);
  if (personal) {
    const snapshot = await findChildByName(
      client,
      scopes,
      personal.id,
      SNAPSHOT_PERSONAL_FILE_NAME,
    );
    if (snapshot) {
      score += 1;
    }
  }
  return score;
};

const scorePersonalRootCandidate = async (
  client: DriveClient,
  scopes: string[],
  candidate: DriveFile,
): Promise<number> => {
  let score = 0;
  const snapshot = await findChildByName(client, scopes, candidate.id, SNAPSHOT_PERSONAL_FILE_NAME);
  if (snapshot) {
    score += 2;
  }
  const events = await findChildByName(client, scopes, candidate.id, EVENTS_FOLDER_NAME);
  if (events) {
    score += 1;
  }
  return score;
};

const scoreSharedRootCandidate = async (
  client: DriveClient,
  scopes: string[],
  candidate: DriveFile,
): Promise<number> => {
  const children = await listChildren(
    client,
    scopes,
    candidate.id,
    "mimeType='application/vnd.google-apps.folder'",
  );
  if (children.length === 0) {
    return 0;
  }
  for (const child of children.slice(0, 5)) {
    const snapshot = await findChildByName(client, scopes, child.id, SNAPSHOT_SHARED_FILE_NAME);
    if (snapshot) {
      return 2;
    }
  }
  return 1;
};
const upsertFile = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  name: string,
  contentType: string,
  content: string,
  options?: { ifMatch?: string; assumeMissing?: boolean },
): Promise<DriveFile> => {
  if (!options?.assumeMissing) {
    const existing = await findChildByName(client, scopes, parentId, name);
    if (existing) {
      const updated = (await client.uploadMedia(
        `/files/${encodeQuery(existing.id)}?uploadType=media&supportsAllDrives=true`,
        contentType,
        content,
        scopes,
        options?.ifMatch ? { ifMatch: options.ifMatch } : undefined,
      )) as unknown as DriveFile;
      return { ...existing, ...updated };
    }
  }
  const metadata = {
    name,
    parents: [parentId],
  };
  const body = buildMultipartBody(metadata, contentType, content);
  const created = (await client.uploadMultipart(
    "/files?uploadType=multipart&supportsAllDrives=true",
    body,
    scopes,
    options?.ifMatch ? { ifMatch: options.ifMatch } : undefined,
  )) as unknown as DriveFile;
  return created;
};

const deleteFile = async (client: DriveClient, scopes: string[], fileId: string) => {
  await client.delete(`/files/${encodeQuery(fileId)}?supportsAllDrives=true`, scopes);
};

const deleteFileByName = async (
  client: DriveClient,
  scopes: string[],
  parentId: string,
  name: string,
) => {
  const existing = await findChildByName(client, scopes, parentId, name);
  if (!existing) {
    return;
  }
  await deleteFile(client, scopes, existing.id);
};

export const createGoogleDriveService = (client: DriveClient, scopes: string[]) => {
  let pointerPromise: Promise<PointerRecord | null> | null = null;
  let appRootPromise: Promise<DriveFile> | null = null;
  let personalRootPromise: Promise<DriveFile> | null = null;
  let eventsFolderPromise: Promise<DriveFile> | null = null;
  let leasesFolderPromise: Promise<DriveFile> | null = null;
  let sharedRootPromise: Promise<DriveFile | null> | null = null;
  let rootProbePromise: Promise<void> | null = null;
  let rootProbeRootId: string | null = null;

  const resetRootCaches = () => {
    pointerPromise = null;
    appRootPromise = null;
    personalRootPromise = null;
    eventsFolderPromise = null;
    leasesFolderPromise = null;
    sharedRootPromise = null;
    rootProbePromise = null;
    rootProbeRootId = null;
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

  const getAppRootFolder = async (): Promise<DriveFile> => {
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
        const resolved = await ensureAppRootFolder(client, scopes);
        await updatePointerRecord({ appRootFolderId: resolved.id });
        return resolved;
      })();
    }
    return appRootPromise;
  };

  const getPersonalRootFolder = async (): Promise<DriveFile> => {
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
        const root = await getAppRootFolder();
        const candidates = await listFoldersByName(
          client,
          scopes,
          root.id,
          PERSONAL_ROOT_FOLDER_NAME,
        );
        const resolved =
          candidates.length === 0
            ? await createFolder(client, scopes, root.id, PERSONAL_ROOT_FOLDER_NAME)
            : candidates.length === 1
              ? candidates[0]
              : await selectBestCandidate(candidates, (candidate) =>
                  scorePersonalRootCandidate(client, scopes, candidate),
                );
        await updatePointerRecord({
          appRootFolderId: root.id,
          personalRootFolderId: resolved.id,
        });
        return resolved;
      })();
    }
    return personalRootPromise;
  };

  const getEventsFolder = async (): Promise<DriveFile> => {
    if (!eventsFolderPromise) {
      eventsFolderPromise = (async () => {
        try {
          const root = await getPersonalRootFolder();
          return await ensureFolderByName(client, scopes, root.id, EVENTS_FOLDER_NAME);
        } catch (error) {
          if (isGoogleDriveError(error) && error.code === "not_found") {
            resetRootCaches();
            const root = await getPersonalRootFolder();
            return await ensureFolderByName(client, scopes, root.id, EVENTS_FOLDER_NAME);
          }
          throw error;
        }
      })();
    }
    return eventsFolderPromise;
  };

  const getLeasesFolder = async (): Promise<DriveFile> => {
    if (!leasesFolderPromise) {
      leasesFolderPromise = (async () => {
        try {
          const root = await getPersonalRootFolder();
          return await ensureFolderByName(client, scopes, root.id, LEASES_FOLDER_NAME);
        } catch (error) {
          if (isGoogleDriveError(error) && error.code === "not_found") {
            resetRootCaches();
            const root = await getPersonalRootFolder();
            return await ensureFolderByName(client, scopes, root.id, LEASES_FOLDER_NAME);
          }
          throw error;
        }
      })();
    }
    return leasesFolderPromise;
  };

  const getSharedRootFolder = async (options?: {
    createIfMissing?: boolean;
  }): Promise<DriveFile | null> => {
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
        const root = await getAppRootFolder();
        const candidates = await listFoldersByName(
          client,
          scopes,
          root.id,
          SHARED_ROOT_FOLDER_NAME,
        );
        let resolved: DriveFile | null = null;
        if (candidates.length > 0) {
          resolved =
            candidates.length === 1
              ? candidates[0]
              : await selectBestCandidate(candidates, (candidate) =>
                  scoreSharedRootCandidate(client, scopes, candidate),
                );
        } else if (options?.createIfMissing) {
          resolved = await createFolder(client, scopes, root.id, SHARED_ROOT_FOLDER_NAME);
        }
        if (resolved) {
          await updatePointerRecord({
            appRootFolderId: root.id,
            sharedRootFolderId: resolved.id,
          });
        }
        return resolved;
      })();
    }
    return sharedRootPromise;
  };

  const ensureRootProbe = async (rootId: string): Promise<void> => {
    if (rootProbePromise && rootProbeRootId === rootId) {
      return rootProbePromise;
    }
    rootProbeRootId = rootId;
    rootProbePromise = (async () => {
      const probe = await findChildByName(client, scopes, rootId, ROOT_PROBE_FILE_NAME);
      if (probe) {
        return;
      }
      const payload = {
        message: "App root initialization file.",
        createdAt: new Date().toISOString(),
      };
      await upsertFile(
        client,
        scopes,
        rootId,
        ROOT_PROBE_FILE_NAME,
        "application/json",
        JSON.stringify(payload),
      );
    })().catch((error) => {
      if (rootProbeRootId === rootId) {
        rootProbePromise = null;
        rootProbeRootId = null;
      }
      throw error;
    });
    return rootProbePromise;
  };

  return {
    ensureAppRoot: async () => {
      const root = await getAppRootFolder();
      await ensureRootProbe(root.id);
      await getPersonalRootFolder();
      return root;
    },
    writeJsonFile: async (fileName: string, data: unknown) => {
      const root = await getPersonalRootFolder();
      await upsertFile(client, scopes, root.id, fileName, "application/json", JSON.stringify(data));
    },
    readJsonFile: async (fileName: string) => {
      const root = await getPersonalRootFolder();
      const file = await findChildByName(client, scopes, root.id, fileName);
      if (!file) {
        throw new GoogleDriveError("File not found.", { status: 404, code: "not_found" });
      }
      const content = await readFileText(client, scopes, file.id);
      return parseJson(content);
    },
    readPersonalSnapshot: async (): Promise<{
      snapshot: Snapshot;
      etag: string | null;
      lastModified: string | null;
    }> => {
      const root = await getPersonalRootFolder();
      const file = await findChildByName(client, scopes, root.id, SNAPSHOT_PERSONAL_FILE_NAME);
      if (!file) {
        throw new GoogleDriveError("Snapshot not found.", { status: 404, code: "not_found" });
      }
      const metadata = (await readFileMetadata(client, scopes, file.id)) as DriveFile;
      const content = await readFileText(client, scopes, file.id);
      const snapshot = parseSnapshot(content);
      return {
        snapshot,
        etag: metadata.etag ?? null,
        lastModified: metadata.modifiedTime ?? null,
      };
    },
    writePersonalSnapshot: async (
      snapshot: Snapshot,
      options?: { ifMatch?: string },
    ): Promise<{ etag: string | null }> => {
      const root = await getPersonalRootFolder();
      const updated = await upsertFile(
        client,
        scopes,
        root.id,
        SNAPSHOT_PERSONAL_FILE_NAME,
        "application/json",
        JSON.stringify(snapshot),
        options,
      );
      const resolved = await ensureFileEtag(client, scopes, updated);
      return {
        etag: resolved.etag ?? null,
      };
    },
    readPersonalLease: async (): Promise<LeaseRecord | null> => {
      const leasesFolder = await getLeasesFolder();
      const leaseFile = await findChildByName(client, scopes, leasesFolder.id, LEASE_FILE_NAME);
      if (!leaseFile) {
        return null;
      }
      const content = await readFileText(client, scopes, leaseFile.id);
      return toLeaseRecord(content);
    },
    writePersonalLease: async (lease: LeaseRecord) => {
      const leasesFolder = await getLeasesFolder();
      await upsertFile(
        client,
        scopes,
        leasesFolder.id,
        LEASE_FILE_NAME,
        "application/json",
        JSON.stringify(lease),
      );
    },
    ensureEventsFolder: async () => {
      await getEventsFolder();
    },
    ensureLeasesFolder: async () => {
      await getLeasesFolder();
    },
    listEventChunkIds: async (): Promise<number[]> => {
      const root = await getPersonalRootFolder();
      const eventsFolder = await findChildByName(client, scopes, root.id, EVENTS_FOLDER_NAME);
      if (!eventsFolder) {
        return [];
      }
      if (!eventsFolderPromise) {
        eventsFolderPromise = Promise.resolve(eventsFolder);
      }
      const files = await listChildren(client, scopes, eventsFolder.id);
      return files
        .map((file) => parseEventChunkId(file.name))
        .filter((value): value is number => typeof value === "number");
    },
    writeEventChunk: async (
      chunkId: number,
      content: string,
      options?: { assumeMissing?: boolean },
    ) => {
      const eventsFolder = await getEventsFolder();
      await upsertFile(
        client,
        scopes,
        eventsFolder.id,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
        "text/plain",
        content,
        options,
      );
    },
    readEventChunk: async (chunkId: number): Promise<string> => {
      const eventsFolder = await getEventsFolder();
      const target = await findChildByName(
        client,
        scopes,
        eventsFolder.id,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
      );
      if (!target) {
        throw new GoogleDriveError("Event chunk not found.", { status: 404, code: "not_found" });
      }
      return readFileText(client, scopes, target.id);
    },
    deleteEventChunk: async (chunkId: number) => {
      const root = await getPersonalRootFolder();
      const eventsFolder = await findChildByName(client, scopes, root.id, EVENTS_FOLDER_NAME);
      if (!eventsFolder) {
        return;
      }
      await deleteFileByName(
        client,
        scopes,
        eventsFolder.id,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
      );
    },
    deleteAllEventChunks: async () => {
      const root = await getPersonalRootFolder();
      const eventsFolder = await findChildByName(client, scopes, root.id, EVENTS_FOLDER_NAME);
      if (!eventsFolder) {
        return;
      }
      if (!eventsFolderPromise) {
        eventsFolderPromise = Promise.resolve(eventsFolder);
      }
      const files = await listChildren(client, scopes, eventsFolder.id);
      for (const file of files) {
        if (parseEventChunkId(file.name) !== null) {
          await deleteFile(client, scopes, file.id);
        }
      }
    },
    ensureSharedRootFolder: async (): Promise<SharedRootListItem> => {
      const shared = await getSharedRootFolder({ createIfMissing: true });
      if (!shared) {
        throw new Error("Shared root is unavailable.");
      }
      return {
        sharedId: shared.id,
        fileId: shared.id,
        driveId: shared.driveId,
        name: shared.name,
        webUrl: shared.webViewLink,
        isFolder: true,
      };
    },
    createSharedFolder: async (name: string): Promise<SharedRootListItem> => {
      const normalized = name.trim();
      if (!normalized) {
        throw new Error("Folder name is required.");
      }
      const sharedRoot = await getSharedRootFolder({ createIfMissing: true });
      if (!sharedRoot) {
        throw new Error("Shared root is unavailable.");
      }
      const created = await ensureFolderByName(client, scopes, sharedRoot.id, normalized);
      return {
        sharedId: created.id,
        fileId: created.id,
        driveId: created.driveId,
        name: created.name,
        webUrl: created.webViewLink,
        isFolder: true,
      };
    },
    createShareLink: async (
      root: SharedRootReference,
      permission: ShareLinkPermission,
    ): Promise<ShareLinkResult> => {
      await client.postJson(
        `/files/${encodeQuery(root.fileId)}/permissions?supportsAllDrives=true`,
        {
          type: "anyone",
          role: permission === "edit" ? "writer" : "reader",
          allowFileDiscovery: false,
        },
        scopes,
      );
      const info = (await readFileMetadata(client, scopes, root.fileId)) as DriveFile;
      if (!info.webViewLink) {
        throw new Error("Share link is unavailable.");
      }
      return {
        permission,
        webUrl: info.webViewLink,
      };
    },
    deleteAppCloudData: async () => {
      try {
        const root = await getAppRootFolder();
        await deleteFile(client, scopes, root.id);
        await deletePointerRecord(client, scopes);
        resetRootCaches();
      } catch (error) {
        if (isGoogleDriveError(error) && error.code === "not_found") {
          await deletePointerRecord(client, scopes);
          resetRootCaches();
          return;
        }
        throw error;
      }
    },
    listSharedWithMeRoots: async (): Promise<SharedRootListItem[]> => {
      const data = (await client.getJson("/files", scopes, {
        q: "sharedWithMe and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: DRIVE_FIELDS,
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        pageSize: "1000",
      })) as DriveListResponse;
      const candidates = data.files ?? [];
      const filtered: SharedRootListItem[] = [];
      for (const candidate of candidates) {
        const snapshot = await findChildByName(
          client,
          scopes,
          candidate.id,
          SNAPSHOT_SHARED_FILE_NAME,
        );
        if (!snapshot) {
          continue;
        }
        filtered.push({
          sharedId: candidate.id,
          fileId: candidate.id,
          driveId: candidate.driveId,
          name: candidate.name,
          webUrl: candidate.webViewLink,
          isFolder: true,
        });
      }
      return filtered;
    },
    listSharedByMeRoots: async (): Promise<SharedRootListItem[]> => {
      const sharedRoot = await getSharedRootFolder({ createIfMissing: false });
      if (!sharedRoot) {
        return [];
      }
      const items = await listChildren(
        client,
        scopes,
        sharedRoot.id,
        "mimeType='application/vnd.google-apps.folder'",
      );
      return items.map((item) => ({
        sharedId: item.id,
        fileId: item.id,
        driveId: item.driveId,
        name: item.name,
        webUrl: item.webViewLink,
        isFolder: true,
      }));
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
    getSharedRootInfo: async (root: SharedRootReference): Promise<SharedRootInfo> => {
      const data = (await readFileMetadata(client, scopes, root.fileId)) as DriveFile;
      return {
        sharedId: root.sharedId,
        fileId: root.fileId,
        driveId: data.driveId,
        name: data.name ?? "Shared item",
        webUrl: data.webViewLink,
        isFolder: isFolder(data),
        canWrite: Boolean(data.capabilities?.canEdit),
      };
    },
    readSharedSnapshot: async (
      root: SharedRootReference,
    ): Promise<{ snapshot: Snapshot; etag: string | null; lastModified: string | null }> => {
      const file = await findChildByName(client, scopes, root.fileId, SNAPSHOT_SHARED_FILE_NAME);
      if (!file) {
        throw new GoogleDriveError("Snapshot not found.", { status: 404, code: "not_found" });
      }
      const metadata = (await readFileMetadata(client, scopes, file.id)) as DriveFile;
      const content = await readFileText(client, scopes, file.id);
      const snapshot = parseSnapshot(content);
      return {
        snapshot,
        etag: metadata.etag ?? null,
        lastModified: metadata.modifiedTime ?? null,
      };
    },
    writeSharedSnapshot: async (
      root: SharedRootReference,
      snapshot: Snapshot,
      options?: { ifMatch?: string },
    ): Promise<{ etag: string | null }> => {
      const updated = await upsertFile(
        client,
        scopes,
        root.fileId,
        SNAPSHOT_SHARED_FILE_NAME,
        "application/json",
        JSON.stringify(snapshot),
        options,
      );
      const resolved = await ensureFileEtag(client, scopes, updated);
      return {
        etag: resolved.etag ?? null,
      };
    },
    ensureSharedEventsFolder: async (root: SharedRootReference) => {
      await ensureFolderByName(client, scopes, root.fileId, EVENTS_FOLDER_NAME);
    },
    ensureSharedLeasesFolder: async (root: SharedRootReference) => {
      await ensureFolderByName(client, scopes, root.fileId, LEASES_FOLDER_NAME);
    },
    listSharedEventChunkIds: async (root: SharedRootReference): Promise<number[]> => {
      const eventsFolder = await findChildByName(client, scopes, root.fileId, EVENTS_FOLDER_NAME);
      if (!eventsFolder) {
        return [];
      }
      const files = await listChildren(client, scopes, eventsFolder.id);
      return files
        .map((file) => parseEventChunkId(file.name))
        .filter((value): value is number => typeof value === "number");
    },
    writeSharedEventChunk: async (
      root: SharedRootReference,
      chunkId: number,
      content: string,
      options?: { assumeMissing?: boolean },
    ) => {
      const eventsFolder = await ensureFolderByName(
        client,
        scopes,
        root.fileId,
        EVENTS_FOLDER_NAME,
      );
      await upsertFile(
        client,
        scopes,
        eventsFolder.id,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
        "text/plain",
        content,
        options,
      );
    },
    readSharedEventChunk: async (root: SharedRootReference, chunkId: number): Promise<string> => {
      const eventsFolder = await ensureFolderByName(
        client,
        scopes,
        root.fileId,
        EVENTS_FOLDER_NAME,
      );
      const target = await findChildByName(
        client,
        scopes,
        eventsFolder.id,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
      );
      if (!target) {
        throw new GoogleDriveError("Event chunk not found.", { status: 404, code: "not_found" });
      }
      return readFileText(client, scopes, target.id);
    },
    deleteSharedEventChunk: async (root: SharedRootReference, chunkId: number) => {
      const eventsFolder = await findChildByName(client, scopes, root.fileId, EVENTS_FOLDER_NAME);
      if (!eventsFolder) {
        return;
      }
      await deleteFileByName(
        client,
        scopes,
        eventsFolder.id,
        `${EVENT_FILE_PREFIX}${chunkId}${EVENT_FILE_EXTENSION}`,
      );
    },
    deleteAllSharedEventChunks: async (root: SharedRootReference) => {
      const eventsFolder = await findChildByName(client, scopes, root.fileId, EVENTS_FOLDER_NAME);
      if (!eventsFolder) {
        return;
      }
      const files = await listChildren(client, scopes, eventsFolder.id);
      for (const file of files) {
        if (parseEventChunkId(file.name) !== null) {
          await deleteFile(client, scopes, file.id);
        }
      }
    },
    readSharedLease: async (root: SharedRootReference): Promise<LeaseRecord | null> => {
      const leasesFolder = await findChildByName(client, scopes, root.fileId, LEASES_FOLDER_NAME);
      if (!leasesFolder) {
        return null;
      }
      const leaseFile = await findChildByName(client, scopes, leasesFolder.id, LEASE_FILE_NAME);
      if (!leaseFile) {
        return null;
      }
      const content = await readFileText(client, scopes, leaseFile.id);
      return toLeaseRecord(content);
    },
    writeSharedLease: async (root: SharedRootReference, lease: LeaseRecord) => {
      const leasesFolder = await ensureFolderByName(
        client,
        scopes,
        root.fileId,
        LEASES_FOLDER_NAME,
      );
      await upsertFile(
        client,
        scopes,
        leasesFolder.id,
        LEASE_FILE_NAME,
        "application/json",
        JSON.stringify(lease),
      );
    },
  };
};
