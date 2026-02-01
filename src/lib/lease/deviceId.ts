const STORAGE_KEY = "pb-device-id";

const getStoredId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const storeId = (value: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return;
  }
};

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pb-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
};

export const getDeviceId = (): string | null => {
  const stored = getStoredId();
  if (stored) {
    return stored;
  }
  const next = createId();
  storeId(next);
  return next;
};
