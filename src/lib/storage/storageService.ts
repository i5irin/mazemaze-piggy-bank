"use client";

import { getGoogleDriveAppRoot, getGoogleScopes } from "@/lib/auth/googleConfig";
import { getGraphScopes } from "@/lib/auth/msalConfig";
import { createGoogleDriveClient } from "@/lib/google/googleDriveClient";
import { createGoogleDriveService } from "@/lib/google/googleDriveService";
import { createGraphClient } from "@/lib/graph/graphClient";
import {
  createOneDriveService,
  decodeSharedId,
  encodeSharedId,
  type ShareLinkPermission as OneDriveShareLinkPermission,
  type SharedRootReference as OneDriveSharedRootReference,
} from "@/lib/onedrive/oneDriveService";
import type { Snapshot } from "@/lib/persistence/snapshot";
import type { LeaseRecord } from "@/lib/storage/lease";
import type {
  CloudProviderId,
  ShareLinkPermission,
  ShareLinkResult,
  SharedRootInfo,
  SharedRootListItem,
  SharedRootReference,
  RootFolderNotice,
  StorageCapabilities,
} from "@/lib/storage/types";

export type StorageService = {
  providerId: CloudProviderId;
  label: string;
  accountLabel: string;
  appRootLabel: string;
  capabilities: StorageCapabilities;
  ensureAppRoot: () => Promise<unknown>;
  writeJsonFile: (fileName: string, data: unknown) => Promise<unknown>;
  readJsonFile: (fileName: string) => Promise<unknown>;
  readPersonalSnapshot: () => Promise<{
    snapshot: Snapshot;
    etag: string | null;
    lastModified: string | null;
  }>;
  writePersonalSnapshot: (
    snapshot: Snapshot,
    options?: { ifMatch?: string },
  ) => Promise<{ etag: string | null }>;
  readPersonalLease: () => Promise<LeaseRecord | null>;
  writePersonalLease: (lease: LeaseRecord) => Promise<void>;
  ensureEventsFolder: () => Promise<void>;
  ensureLeasesFolder: () => Promise<void>;
  listEventChunkIds: () => Promise<number[]>;
  readEventChunk: (chunkId: number) => Promise<string>;
  writeEventChunk: (
    chunkId: number,
    content: string,
    options?: { assumeMissing?: boolean },
  ) => Promise<void>;
  deleteEventChunk: (chunkId: number) => Promise<void>;
  deleteAllEventChunks: () => Promise<void>;
  ensureSharedRootFolder: () => Promise<SharedRootListItem>;
  createSharedFolder: (name: string) => Promise<SharedRootListItem>;
  listSharedWithMeRoots: () => Promise<SharedRootListItem[]>;
  listSharedByMeRoots: () => Promise<SharedRootListItem[]>;
  getSharedRootInfo: (root: SharedRootReference) => Promise<SharedRootInfo>;
  createShareLink: (
    root: SharedRootReference,
    permission: ShareLinkPermission,
  ) => Promise<ShareLinkResult>;
  deleteAppCloudData: () => Promise<void>;
  readSharedSnapshot: (
    root: SharedRootReference,
  ) => Promise<{ snapshot: Snapshot; etag: string | null; lastModified: string | null }>;
  writeSharedSnapshot: (
    root: SharedRootReference,
    snapshot: Snapshot,
    options?: { ifMatch?: string },
  ) => Promise<{ etag: string | null }>;
  ensureSharedEventsFolder: (root: SharedRootReference) => Promise<void>;
  ensureSharedLeasesFolder: (root: SharedRootReference) => Promise<void>;
  listSharedEventChunkIds: (root: SharedRootReference) => Promise<number[]>;
  readSharedEventChunk: (root: SharedRootReference, chunkId: number) => Promise<string>;
  writeSharedEventChunk: (
    root: SharedRootReference,
    chunkId: number,
    content: string,
    options?: { assumeMissing?: boolean },
  ) => Promise<void>;
  deleteSharedEventChunk: (root: SharedRootReference, chunkId: number) => Promise<void>;
  deleteAllSharedEventChunks: (root: SharedRootReference) => Promise<void>;
  readSharedLease: (root: SharedRootReference) => Promise<LeaseRecord | null>;
  writeSharedLease: (root: SharedRootReference, lease: LeaseRecord) => Promise<void>;
  getRootFolderNotices: () => Promise<RootFolderNotice[]>;
};

const toOneDriveReference = (root: SharedRootReference): OneDriveSharedRootReference => {
  if (root.driveId && root.itemId) {
    return {
      sharedId: encodeSharedId(root.driveId, root.itemId),
      driveId: root.driveId,
      itemId: root.itemId,
    };
  }
  const decoded = decodeSharedId(root.sharedId);
  if (!decoded) {
    throw new Error("Invalid shared id.");
  }
  return {
    sharedId: encodeSharedId(decoded.driveId, decoded.itemId),
    driveId: decoded.driveId,
    itemId: decoded.itemId,
  };
};

const toSharedRootListItem = (
  providerId: CloudProviderId,
  item: {
    sharedId: string;
    driveId?: string;
    itemId?: string;
    name: string;
    webUrl?: string;
    isFolder: boolean;
  },
): SharedRootListItem => ({
  providerId,
  sharedId: item.sharedId,
  driveId: item.driveId,
  itemId: item.itemId,
  name: item.name,
  webUrl: item.webUrl,
  isFolder: item.isFolder,
});

const toSharedRootInfo = (
  providerId: CloudProviderId,
  item: {
    sharedId: string;
    driveId?: string;
    itemId?: string;
    name: string;
    webUrl?: string;
    isFolder: boolean;
    canWrite: boolean;
  },
): SharedRootInfo => ({
  providerId,
  sharedId: item.sharedId,
  driveId: item.driveId,
  itemId: item.itemId,
  name: item.name,
  webUrl: item.webUrl,
  isFolder: item.isFolder,
  canWrite: item.canWrite,
});

const normalizePathSegments = (value: string): string[] => {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) {
    return [];
  }
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const segments = trimmed
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

const getExpectedRootName = (value: string): string | null => {
  const segments = normalizePathSegments(value);
  if (segments.length === 0) {
    return null;
  }
  return segments[segments.length - 1];
};

const buildRootNotices = (
  info: {
    appRoot?: { id: string; name: string };
    personalRoot?: { id: string; name: string };
    sharedRoot?: { id: string; name: string };
  },
  expectedAppName: string | null,
): RootFolderNotice[] => {
  const notices: RootFolderNotice[] = [];
  if (expectedAppName && info.appRoot && info.appRoot.name !== expectedAppName) {
    notices.push({
      scope: "app",
      expectedName: expectedAppName,
      actualName: info.appRoot.name,
    });
  }
  if (info.personalRoot && info.personalRoot.name !== "personal") {
    notices.push({
      scope: "personal",
      expectedName: "personal",
      actualName: info.personalRoot.name,
    });
  }
  if (info.sharedRoot && info.sharedRoot.name !== "shared") {
    notices.push({
      scope: "shared",
      expectedName: "shared",
      actualName: info.sharedRoot.name,
    });
  }
  return notices;
};

type AccessTokenProvider = (scopes: string[]) => Promise<string>;

type AccessTokenProviderRef = { current: AccessTokenProvider };

const accessTokenProviderRefs = new Map<CloudProviderId, AccessTokenProviderRef>();
const accessTokenProviderProxies = new Map<CloudProviderId, AccessTokenProvider>();

const getAccessTokenProviderProxy = (
  providerId: CloudProviderId,
  accessTokenProvider: AccessTokenProvider,
): AccessTokenProvider => {
  let ref = accessTokenProviderRefs.get(providerId);
  if (!ref) {
    ref = { current: accessTokenProvider };
    accessTokenProviderRefs.set(providerId, ref);
  } else {
    ref.current = accessTokenProvider;
  }
  let proxy = accessTokenProviderProxies.get(providerId);
  if (!proxy) {
    proxy = (scopes) => ref!.current(scopes);
    accessTokenProviderProxies.set(providerId, proxy);
  }
  return proxy;
};

const storageServiceCache = new Map<CloudProviderId, StorageService>();

export const createStorageService = (
  providerId: CloudProviderId,
  accessTokenProvider: AccessTokenProvider,
): StorageService => {
  const proxyAccessTokenProvider = getAccessTokenProviderProxy(providerId, accessTokenProvider);
  const cached = storageServiceCache.get(providerId);
  if (cached) {
    return cached;
  }
  if (providerId === "gdrive") {
    const googleClient = createGoogleDriveClient({ accessTokenProvider: proxyAccessTokenProvider });
    const google = createGoogleDriveService(googleClient, getGoogleScopes());
    const rootLabel = getGoogleDriveAppRoot();
    const expectedAppName = getExpectedRootName(rootLabel);
    const service: StorageService = {
      providerId,
      label: "Google Drive",
      accountLabel: "Google",
      appRootLabel: rootLabel,
      capabilities: {
        supportsShared: true,
        supportsShareLinks: true,
      },
      ensureAppRoot: google.ensureAppRoot,
      writeJsonFile: google.writeJsonFile,
      readJsonFile: google.readJsonFile,
      readPersonalSnapshot: google.readPersonalSnapshot,
      writePersonalSnapshot: google.writePersonalSnapshot,
      readPersonalLease: google.readPersonalLease,
      writePersonalLease: google.writePersonalLease,
      ensureEventsFolder: google.ensureEventsFolder,
      ensureLeasesFolder: google.ensureLeasesFolder,
      listEventChunkIds: google.listEventChunkIds,
      readEventChunk: google.readEventChunk,
      writeEventChunk: google.writeEventChunk,
      deleteEventChunk: google.deleteEventChunk,
      deleteAllEventChunks: google.deleteAllEventChunks,
      ensureSharedRootFolder: async () => {
        const root = await google.ensureSharedRootFolder();
        return toSharedRootListItem(providerId, {
          sharedId: root.sharedId,
          driveId: root.driveId,
          itemId: root.fileId,
          name: root.name,
          webUrl: root.webUrl,
          isFolder: root.isFolder,
        });
      },
      createSharedFolder: async (name: string) => {
        const created = await google.createSharedFolder(name);
        return toSharedRootListItem(providerId, {
          sharedId: created.sharedId,
          driveId: created.driveId,
          itemId: created.fileId,
          name: created.name,
          webUrl: created.webUrl,
          isFolder: created.isFolder,
        });
      },
      listSharedWithMeRoots: async () =>
        (await google.listSharedWithMeRoots()).map((item) =>
          toSharedRootListItem(providerId, {
            sharedId: item.sharedId,
            driveId: item.driveId,
            itemId: item.fileId,
            name: item.name,
            webUrl: item.webUrl,
            isFolder: item.isFolder,
          }),
        ),
      listSharedByMeRoots: async () =>
        (await google.listSharedByMeRoots()).map((item) =>
          toSharedRootListItem(providerId, {
            sharedId: item.sharedId,
            driveId: item.driveId,
            itemId: item.fileId,
            name: item.name,
            webUrl: item.webUrl,
            isFolder: item.isFolder,
          }),
        ),
      getSharedRootInfo: async (root) =>
        toSharedRootInfo(providerId, {
          ...(await google.getSharedRootInfo({
            sharedId: root.sharedId,
            fileId: root.itemId ?? root.sharedId,
            driveId: root.driveId,
          })),
          itemId: root.itemId ?? root.sharedId,
        }),
      createShareLink: async (root, permission) =>
        google.createShareLink(
          {
            sharedId: root.sharedId,
            fileId: root.itemId ?? root.sharedId,
            driveId: root.driveId,
          },
          permission,
        ),
      deleteAppCloudData: google.deleteAppCloudData,
      readSharedSnapshot: async (root) =>
        google.readSharedSnapshot({
          sharedId: root.sharedId,
          fileId: root.itemId ?? root.sharedId,
          driveId: root.driveId,
        }),
      writeSharedSnapshot: async (root, snapshot, options) =>
        google.writeSharedSnapshot(
          {
            sharedId: root.sharedId,
            fileId: root.itemId ?? root.sharedId,
            driveId: root.driveId,
          },
          snapshot,
          options,
        ),
      ensureSharedEventsFolder: async (root) =>
        google.ensureSharedEventsFolder({
          sharedId: root.sharedId,
          fileId: root.itemId ?? root.sharedId,
          driveId: root.driveId,
        }),
      ensureSharedLeasesFolder: async (root) =>
        google.ensureSharedLeasesFolder({
          sharedId: root.sharedId,
          fileId: root.itemId ?? root.sharedId,
          driveId: root.driveId,
        }),
      listSharedEventChunkIds: async (root) =>
        google.listSharedEventChunkIds({
          sharedId: root.sharedId,
          fileId: root.itemId ?? root.sharedId,
          driveId: root.driveId,
        }),
      readSharedEventChunk: async (root, chunkId) =>
        google.readSharedEventChunk(
          { sharedId: root.sharedId, fileId: root.itemId ?? root.sharedId, driveId: root.driveId },
          chunkId,
        ),
      writeSharedEventChunk: async (root, chunkId, content, options) =>
        google.writeSharedEventChunk(
          { sharedId: root.sharedId, fileId: root.itemId ?? root.sharedId, driveId: root.driveId },
          chunkId,
          content,
          options,
        ),
      deleteSharedEventChunk: async (root, chunkId) =>
        google.deleteSharedEventChunk(
          { sharedId: root.sharedId, fileId: root.itemId ?? root.sharedId, driveId: root.driveId },
          chunkId,
        ),
      deleteAllSharedEventChunks: async (root) =>
        google.deleteAllSharedEventChunks({
          sharedId: root.sharedId,
          fileId: root.itemId ?? root.sharedId,
          driveId: root.driveId,
        }),
      readSharedLease: async (root) =>
        google.readSharedLease({
          sharedId: root.sharedId,
          fileId: root.itemId ?? root.sharedId,
          driveId: root.driveId,
        }),
      writeSharedLease: async (root, lease) =>
        google.writeSharedLease(
          { sharedId: root.sharedId, fileId: root.itemId ?? root.sharedId, driveId: root.driveId },
          lease,
        ),
      getRootFolderNotices: async () => {
        const info = await google.getRootFolderInfo();
        return buildRootNotices(info, expectedAppName);
      },
    };
    storageServiceCache.set(providerId, service);
    return service;
  }

  const graphClient = createGraphClient({ accessTokenProvider: proxyAccessTokenProvider });
  const oneDrive = createOneDriveService(graphClient, getGraphScopes());
  const rootLabel = process.env.NEXT_PUBLIC_ONEDRIVE_APP_ROOT ?? "/Apps/Mazemaze Piggy Bank/";
  // OneDrive app root follows the Azure app display name, which we keep spaced for branding.
  // Google Drive uses a fixed "MazemazePiggyBank" folder name instead.
  const expectedAppName = "Mazemaze Piggy Bank";
  const service: StorageService = {
    providerId,
    label: "OneDrive",
    accountLabel: "Microsoft",
    appRootLabel: rootLabel,
    capabilities: {
      supportsShared: true,
      supportsShareLinks: true,
    },
    ensureAppRoot: oneDrive.ensureAppRoot,
    writeJsonFile: oneDrive.writeJsonFile,
    readJsonFile: oneDrive.readJsonFile,
    readPersonalSnapshot: oneDrive.readPersonalSnapshot,
    writePersonalSnapshot: oneDrive.writePersonalSnapshot,
    readPersonalLease: oneDrive.readPersonalLease,
    writePersonalLease: oneDrive.writePersonalLease,
    ensureEventsFolder: oneDrive.ensureEventsFolder,
    ensureLeasesFolder: oneDrive.ensureLeasesFolder,
    listEventChunkIds: oneDrive.listEventChunkIds,
    readEventChunk: oneDrive.readEventChunk,
    writeEventChunk: oneDrive.writeEventChunk,
    deleteEventChunk: async (chunkId: number) => {
      await oneDrive.deleteEventChunk(chunkId);
    },
    deleteAllEventChunks: async () => {
      await oneDrive.deleteAllEventChunks();
    },
    ensureSharedRootFolder: async () => {
      const root = await oneDrive.ensureSharedRootFolder();
      return toSharedRootListItem(providerId, root);
    },
    createSharedFolder: async (name: string) =>
      toSharedRootListItem(providerId, await oneDrive.createSharedFolder(name)),
    listSharedWithMeRoots: async () =>
      (await oneDrive.listSharedWithMeRoots()).map((item) =>
        toSharedRootListItem(providerId, item),
      ),
    listSharedByMeRoots: async () =>
      (await oneDrive.listSharedByMeRoots()).map((item) => toSharedRootListItem(providerId, item)),
    getSharedRootInfo: async (root) =>
      toSharedRootInfo(providerId, await oneDrive.getSharedRootInfo(toOneDriveReference(root))),
    createShareLink: async (root, permission) =>
      oneDrive.createShareLink(
        toOneDriveReference(root),
        permission as OneDriveShareLinkPermission,
      ),
    deleteAppCloudData: oneDrive.deleteAppCloudData,
    readSharedSnapshot: async (root) => oneDrive.readSharedSnapshot(toOneDriveReference(root)),
    writeSharedSnapshot: async (root, snapshot, options) =>
      oneDrive.writeSharedSnapshot(toOneDriveReference(root), snapshot, options),
    ensureSharedEventsFolder: async (root) =>
      oneDrive.ensureSharedEventsFolder(toOneDriveReference(root)),
    ensureSharedLeasesFolder: async (root) =>
      oneDrive.ensureSharedLeasesFolder(toOneDriveReference(root)),
    listSharedEventChunkIds: async (root) =>
      oneDrive.listSharedEventChunkIds(toOneDriveReference(root)),
    readSharedEventChunk: async (root, chunkId) =>
      oneDrive.readSharedEventChunk(toOneDriveReference(root), chunkId),
    writeSharedEventChunk: async (root, chunkId, content, options) =>
      oneDrive.writeSharedEventChunk(toOneDriveReference(root), chunkId, content, options),
    deleteSharedEventChunk: async (root, chunkId) => {
      await oneDrive.deleteSharedEventChunk(toOneDriveReference(root), chunkId);
    },
    deleteAllSharedEventChunks: async (root) => {
      await oneDrive.deleteAllSharedEventChunks(toOneDriveReference(root));
    },
    readSharedLease: async (root) => oneDrive.readSharedLease(toOneDriveReference(root)),
    writeSharedLease: async (root, lease) =>
      oneDrive.writeSharedLease(toOneDriveReference(root), lease),
    getRootFolderNotices: async () => {
      const info = await oneDrive.getRootFolderInfo();
      return buildRootNotices(info, expectedAppName);
    },
  };
  storageServiceCache.set(providerId, service);
  return service;
};
