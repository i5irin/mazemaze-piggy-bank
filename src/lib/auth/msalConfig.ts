"use client";

import type { Configuration } from "@azure/msal-browser";
import { AuthError } from "./authErrors";

const DEFAULT_AUTHORITY = "https://login.microsoftonline.com/consumers";

const readRequiredEnv = (value: string | undefined, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AuthError("missing-config", `Missing required environment variable: ${name}.`);
  }
  return value.trim();
};

export const getMsalConfig = (): Configuration => {
  const clientId = readRequiredEnv(
    process.env.NEXT_PUBLIC_MSAL_CLIENT_ID,
    "NEXT_PUBLIC_MSAL_CLIENT_ID",
  );
  const redirectUri = readRequiredEnv(
    process.env.NEXT_PUBLIC_MSAL_REDIRECT_URI,
    "NEXT_PUBLIC_MSAL_REDIRECT_URI",
  );
  const authority = process.env.NEXT_PUBLIC_MSAL_AUTHORITY?.trim() || DEFAULT_AUTHORITY;

  return {
    auth: {
      clientId,
      redirectUri,
      authority,
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false,
    },
  };
};

export const getGraphScopes = (): string[] => ["User.Read", "Files.ReadWrite.AppFolder"];
