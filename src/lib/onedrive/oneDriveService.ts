"use client";

import { createGraphClient } from "@/lib/graph/graphClient";
import { GraphError, isGraphError } from "@/lib/graph/graphErrors";
import { parseSnapshot, type Snapshot } from "@/lib/persistence/snapshot";

export const DEFAULT_TEST_FILE_NAME = "pb-test.json";
const ROOT_PROBE_FILE_NAME = ".pb-root.json";
const APP_ROOT_PATH = "/me/drive/special/approot";
const SNAPSHOT_PERSONAL_FILE_NAME = "snapshot-personal.json";
const EVENTS_FOLDER_NAME = "events";
const EVENT_FILE_PREFIX = "event-";
const EVENT_FILE_EXTENSION = ".jsonl";

type GraphClient = ReturnType<typeof createGraphClient>;

const encodeDrivePath = (path: string) => encodeURIComponent(path).replace(/%2F/g, "/");

const buildPathFromSegments = (segments: string[]) => encodeDrivePath(segments.join("/"));

const buildContentPathFromSegments = (segments: string[]) =>
  `${APP_ROOT_PATH}:/${buildPathFromSegments(segments)}:/content`;

const buildItemPathFromSegments = (segments: string[]) =>
  `${APP_ROOT_PATH}:/${buildPathFromSegments(segments)}`;

const buildChildrenPathFromSegments = (segments: string[]) =>
  segments.length === 0
    ? `${APP_ROOT_PATH}/children`
    : `${APP_ROOT_PATH}:/${buildPathFromSegments(segments)}:/children`;

const buildContentPath = (fileName: string) => buildContentPathFromSegments([fileName]);

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
});
