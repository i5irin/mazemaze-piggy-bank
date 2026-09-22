export type GoogleDriveErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "precondition_failed"
  | "network_error"
  | "unknown";

export class GoogleDriveError extends Error {
  status: number | null;
  code: GoogleDriveErrorCode;

  constructor(message: string, options: { status: number | null; code: GoogleDriveErrorCode }) {
    super(message);
    this.name = "GoogleDriveError";
    this.status = options.status;
    this.code = options.code;
  }
}

export const isGoogleDriveError = (value: unknown): value is GoogleDriveError =>
  value instanceof GoogleDriveError;
