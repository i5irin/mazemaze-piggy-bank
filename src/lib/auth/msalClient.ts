"use client";

import { PublicClientApplication } from "@azure/msal-browser";
import { getMsalConfig } from "./msalConfig";

let msalInstance: PublicClientApplication | null = null;

export const getMsalInstance = (): PublicClientApplication => {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(getMsalConfig());
  }
  return msalInstance;
};
