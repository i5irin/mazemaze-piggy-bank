"use client";

import { GraphError, type GraphErrorCode } from "./graphErrors";

export type AccessTokenProvider = (scopes: string[]) => Promise<string>;

export type GraphRetryInfo = {
  attempt: number;
  delayMs: number;
  retryAfterSeconds?: number;
};

type RequestOptions = {
  scopes: string[];
  responseType: "json" | "text";
  onRetry?: (info: GraphRetryInfo) => void;
};

type GraphClientOptions = {
  accessTokenProvider: AccessTokenProvider;
  onRetry?: (info: GraphRetryInfo) => void;
};

export type GraphResponse<T> = {
  data: T;
  headers: Headers;
};

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRetryAfterSeconds = (headers: Headers): number | null => {
  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }
  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds)) {
    return seconds;
  }
  const retryDate = Date.parse(retryAfter);
  if (!Number.isNaN(retryDate)) {
    const deltaMs = retryDate - Date.now();
    return Math.max(0, Math.ceil(deltaMs / 1000));
  }
  return null;
};

const toGraphError = async (response: Response): Promise<GraphError> => {
  const status = response.status;
  const retryAfterSeconds = getRetryAfterSeconds(response.headers) ?? undefined;
  let message = "Microsoft Graph request failed.";
  let code: GraphErrorCode = "unknown";

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

  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body)) {
      const error = body.error;
      if (isRecord(error) && typeof error.message === "string") {
        message = error.message;
      }
    }
  } catch {
    // Keep default message when response is not JSON.
  }

  return new GraphError(message, {
    status,
    code,
    retryAfterSeconds,
  });
};

const requestGraph = async <T>(
  path: string,
  init: RequestInit,
  options: RequestOptions,
  accessTokenProvider: AccessTokenProvider,
): Promise<GraphResponse<T>> => {
  const url = path.startsWith("/") ? `${GRAPH_BASE_URL}${path}` : `${GRAPH_BASE_URL}/${path}`;
  const token = await accessTokenProvider(options.scopes);
  let attempt = 0;

  while (true) {
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
      throw new GraphError("Network error. Please check your connection.", {
        status: null,
        code: "network_error",
      });
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterSeconds = getRetryAfterSeconds(response.headers);
      const delayMs =
        (retryAfterSeconds ? retryAfterSeconds * 1000 : null) ?? BASE_DELAY_MS * 2 ** attempt;
      options.onRetry?.({
        attempt: attempt + 1,
        delayMs,
        retryAfterSeconds: retryAfterSeconds ?? Math.ceil(delayMs / 1000),
      });
      attempt += 1;
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      throw await toGraphError(response);
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
  }
};

export const createGraphClient = ({ accessTokenProvider, onRetry }: GraphClientOptions) => ({
  getJsonWithHeaders: async (path: string, scopes: string[]) =>
    requestGraph<unknown>(
      path,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      { scopes, responseType: "json", onRetry },
      accessTokenProvider,
    ),
  getJson: async (path: string, scopes: string[]) =>
    (
      await requestGraph<unknown>(
        path,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        { scopes, responseType: "json", onRetry },
        accessTokenProvider,
      )
    ).data,
  getTextWithHeaders: async (path: string, scopes: string[]) =>
    requestGraph<string>(
      path,
      {
        method: "GET",
        headers: {
          Accept: "text/plain",
        },
      },
      { scopes, responseType: "text", onRetry },
      accessTokenProvider,
    ),
  getText: async (path: string, scopes: string[]) =>
    (
      await requestGraph<string>(
        path,
        {
          method: "GET",
          headers: {
            Accept: "text/plain",
          },
        },
        { scopes, responseType: "text", onRetry },
        accessTokenProvider,
      )
    ).data,
  putJsonWithHeaders: async (
    path: string,
    body: unknown,
    scopes: string[],
    options?: { ifMatch?: string },
  ) =>
    requestGraph<unknown>(
      path,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
        },
        body: JSON.stringify(body),
      },
      { scopes, responseType: "json", onRetry },
      accessTokenProvider,
    ),
  putJson: async (path: string, body: unknown, scopes: string[], options?: { ifMatch?: string }) =>
    (
      await requestGraph<unknown>(
        path,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
          },
          body: JSON.stringify(body),
        },
        { scopes, responseType: "json", onRetry },
        accessTokenProvider,
      )
    ).data,
  putText: async (path: string, body: string, scopes: string[], options?: { ifMatch?: string }) =>
    (
      await requestGraph<unknown>(
        path,
        {
          method: "PUT",
          headers: {
            "Content-Type": "text/plain",
            ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
          },
          body,
        },
        { scopes, responseType: "json", onRetry },
        accessTokenProvider,
      )
    ).data,
  postJson: async (path: string, body: unknown, scopes: string[]) =>
    (
      await requestGraph<unknown>(
        path,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        { scopes, responseType: "json", onRetry },
        accessTokenProvider,
      )
    ).data,
});
