import { AuthError } from "./authErrors";

const DEFAULT_APP_ROOT = "/My Drive/Apps/MazemazePiggyBank/";

export const getGoogleClientId = (): string => {
  const value = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!value || value.trim().length === 0) {
    throw new AuthError("missing-config", "Missing Google client ID.");
  }
  return value.trim();
};

export const getGoogleScopes = (): string[] => [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
];

export const getGoogleDriveAppRoot = (): string =>
  process.env.NEXT_PUBLIC_GOOGLE_DRIVE_APP_ROOT?.trim() || DEFAULT_APP_ROOT;
