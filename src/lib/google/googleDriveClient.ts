"use client";

import { GoogleDriveError, type GoogleDriveErrorCode } from "./googleDriveErrors";

export type AccessTokenProvider = (scopes: string[]) => Promise<string>;

type RequestOptions = {
  scopes: string[];
  responseType: "json" | "text";
};

type GoogleDriveClientOptions = {
  accessTokenProvider: AccessTokenProvider;
};

export type GoogleDriveResponse<T> = {
  data: T;
  headers: Headers;
};

const DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toDriveError = async (response: Response): Promise<GoogleDriveError> => {
  const status = response.status;
  let code: GoogleDriveErrorCode = "unknown";
  if (status === 401) {
    code = "unauthorized";
  } else if (status === 403) {
    code = "forbidden";
  } else if (status === 404) {
    code = "not_found";
  } else if (status === 412) {
    code = "precondition_failed";
  } else if (status === 429) {
    code = "rate_limited";
  }
  let message = "Google Drive request failed.";
  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
      message = body.error.message;
    }
  } catch {
    // Keep default message.
  }
  return new GoogleDriveError(message, { status, code });
};

const requestDrive = async <T>(
  url: string,
  init: RequestInit,
  options: RequestOptions,
  accessTokenProvider: AccessTokenProvider,
): Promise<GoogleDriveResponse<T>> => {
  const rawToken = await accessTokenProvider(options.scopes);
  const token = rawToken.trim();
  if (!token) {
    throw new GoogleDriveError("Missing access token. Please sign in again.", {
      status: 401,
      code: "unauthorized",
    });
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new GoogleDriveError("Network error. Please check your connection.", {
      status: null,
      code: "network_error",
    });
  }

  if (!response.ok) {
    throw await toDriveError(response);
  }

  if (options.responseType === "text") {
    const data = (await response.text()) as T;
    return { data, headers: response.headers };
  }

  if (response.status === 204) {
    return { data: null as T, headers: response.headers };
  }

  const data = (await response.json()) as T;
  return { data, headers: response.headers };
};

const buildUrl = (base: string, path: string, query?: Record<string, string | undefined>) => {
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString();
};

export const createGoogleDriveClient = ({ accessTokenProvider }: GoogleDriveClientOptions) => ({
  getJsonWithHeaders: async (path: string, scopes: string[], query?: Record<string, string>) =>
    requestDrive<unknown>(
      buildUrl(DRIVE_BASE_URL, path, query),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      { scopes, responseType: "json" },
      accessTokenProvider,
    ),
  getJson: async (path: string, scopes: string[], query?: Record<string, string>) =>
    (
      await requestDrive<unknown>(
        buildUrl(DRIVE_BASE_URL, path, query),
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        { scopes, responseType: "json" },
        accessTokenProvider,
      )
    ).data,
  getTextWithHeaders: async (path: string, scopes: string[], query?: Record<string, string>) =>
    requestDrive<string>(
      buildUrl(DRIVE_BASE_URL, path, query),
      {
        method: "GET",
        headers: {
          Accept: "text/plain",
        },
      },
      { scopes, responseType: "text" },
      accessTokenProvider,
    ),
  getText: async (path: string, scopes: string[], query?: Record<string, string>) =>
    (
      await requestDrive<string>(
        buildUrl(DRIVE_BASE_URL, path, query),
        {
          method: "GET",
          headers: {
            Accept: "text/plain",
          },
        },
        { scopes, responseType: "text" },
        accessTokenProvider,
      )
    ).data,
  postJson: async (path: string, body: unknown, scopes: string[]) =>
    (
      await requestDrive<unknown>(
        buildUrl(DRIVE_BASE_URL, path),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        { scopes, responseType: "json" },
        accessTokenProvider,
      )
    ).data,
  patchJson: async (
    path: string,
    body: unknown,
    scopes: string[],
    options?: { ifMatch?: string },
  ) =>
    (
      await requestDrive<unknown>(
        buildUrl(DRIVE_BASE_URL, path),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
          },
          body: JSON.stringify(body),
        },
        { scopes, responseType: "json" },
        accessTokenProvider,
      )
    ).data,
  delete: async (path: string, scopes: string[]) =>
    (
      await requestDrive<unknown>(
        buildUrl(DRIVE_BASE_URL, path),
        {
          method: "DELETE",
        },
        { scopes, responseType: "json" },
        accessTokenProvider,
      )
    ).data,
  uploadMultipart: async (
    path: string,
    body: string,
    scopes: string[],
    options?: { ifMatch?: string },
  ) => {
    const response = await requestDrive<unknown>(
      buildUrl(UPLOAD_BASE_URL, path),
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
          ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
        },
        body,
      },
      { scopes, responseType: "json" },
      accessTokenProvider,
    );
    const data = response.data;
    const etag = response.headers.get("etag");
    if (etag && isRecord(data)) {
      data.etag = etag;
    }
    return data;
  },
  uploadMedia: async (
    path: string,
    contentType: string,
    body: string,
    scopes: string[],
    options?: { ifMatch?: string },
  ) => {
    const response = await requestDrive<unknown>(
      buildUrl(UPLOAD_BASE_URL, path),
      {
        method: "PATCH",
        headers: {
          "Content-Type": contentType,
          ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
        },
        body,
      },
      { scopes, responseType: "json" },
      accessTokenProvider,
    );
    const data = response.data;
    const etag = response.headers.get("etag");
    if (etag && isRecord(data)) {
      data.etag = etag;
    }
    return data;
  },
});

const MULTIPART_BOUNDARY = "-------314159265358979323846";

export const buildMultipartBody = (
  metadata: Record<string, unknown>,
  contentType: string,
  content: string,
): string => {
  const safeContent = content ?? "";
  return [
    `--${MULTIPART_BOUNDARY}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${MULTIPART_BOUNDARY}`,
    `Content-Type: ${contentType}`,
    "",
    safeContent,
    `--${MULTIPART_BOUNDARY}--`,
    "",
  ].join("\r\n");
};
