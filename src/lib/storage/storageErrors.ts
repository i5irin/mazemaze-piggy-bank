import { isGraphError } from "@/lib/graph/graphErrors";
import { isGoogleDriveError } from "@/lib/google/googleDriveErrors";

export const isStorageNotFound = (error: unknown): boolean =>
  (isGraphError(error) && error.status === 404) ||
  (isGoogleDriveError(error) && error.code === "not_found");

export const isStorageNetworkError = (error: unknown): boolean =>
  (isGraphError(error) && error.code === "network_error") ||
  (isGoogleDriveError(error) && error.code === "network_error");

export const isStoragePermissionScopeError = (error: unknown): boolean =>
  isGoogleDriveError(error) &&
  error.code === "forbidden" &&
  error.message.toLowerCase().includes("scope");

export const isStoragePreconditionFailed = (error: unknown): boolean =>
  (isGraphError(error) && error.code === "precondition_failed") ||
  (isGoogleDriveError(error) && error.code === "precondition_failed");

export const formatStorageError = (error: unknown): string => {
  if (isGraphError(error)) {
    if (error.code === "unauthorized") {
      return "Authentication failed. Please sign in again.";
    }
    if (error.code === "forbidden") {
      return "Permission denied. Please consent to the required scopes.";
    }
    if (error.code === "not_found") {
      return "The requested file was not found.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Please wait and try again.";
    }
    if (error.code === "network_error") {
      return "Network error. Please check your connection.";
    }
    if (error.code === "precondition_failed") {
      return "The data changed in the cloud. Please reload and try again.";
    }
    return "Cloud request failed. Please try again.";
  }
  if (isGoogleDriveError(error)) {
    if (error.code === "forbidden" && error.message.includes("unregistered callers")) {
      return "Google Drive rejected the request because the caller identity is missing. Check the Google client ID and ensure the Drive API is enabled.";
    }
    if (error.code === "unauthorized") {
      return "Authentication failed. Please sign in again.";
    }
    if (error.code === "forbidden") {
      return "Permission denied. Please consent to the required scopes.";
    }
    if (error.code === "not_found") {
      return "The requested file was not found.";
    }
    if (error.code === "rate_limited") {
      return "Too many requests. Please wait and try again.";
    }
    if (error.code === "network_error") {
      return "Network error. Please check your connection.";
    }
    if (error.code === "precondition_failed") {
      return "The data changed in the cloud. Please reload and try again.";
    }
    return "Cloud request failed. Please try again.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
};
