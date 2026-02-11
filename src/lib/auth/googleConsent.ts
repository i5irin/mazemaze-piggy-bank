"use client";

const STORAGE_KEY = "mazemaze-google-consent-prompted";
let prompted = false;

const readSessionFlag = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeSessionFlag = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Ignore storage errors.
  }
};

export const canPromptGoogleConsent = (): boolean => {
  if (prompted) {
    return false;
  }
  if (readSessionFlag()) {
    return false;
  }
  return true;
};

export const markGoogleConsentPrompted = (): void => {
  prompted = true;
  writeSessionFlag();
};
