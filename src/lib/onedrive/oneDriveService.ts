"use client";

import { createGraphClient } from "@/lib/graph/graphClient";
import { GraphError } from "@/lib/graph/graphErrors";

export const DEFAULT_TEST_FILE_NAME = "pb-test.json";
const ROOT_PROBE_FILE_NAME = ".pb-root.json";
const APP_ROOT_PATH = "/me/drive/special/approot";

type GraphClient = ReturnType<typeof createGraphClient>;

const buildContentPath = (fileName: string) =>
  `${APP_ROOT_PATH}:/${encodeURIComponent(fileName)}:/content`;

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
});
