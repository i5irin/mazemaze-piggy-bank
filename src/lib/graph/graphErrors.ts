"use client";

export type GraphErrorCode =
  | "network_error"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "precondition_failed"
  | "unknown";

export class GraphError extends Error {
  status: number | null;
  code: GraphErrorCode;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    options: {
      status: number | null;
      code: GraphErrorCode;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "GraphError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const isGraphError = (value: unknown): value is GraphError => value instanceof GraphError;

export const isPreconditionFailed = (value: unknown): value is GraphError =>
  value instanceof GraphError && value.code === "precondition_failed";
