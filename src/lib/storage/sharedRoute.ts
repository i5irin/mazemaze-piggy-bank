import type { CloudProviderId } from "./types";

const DEFAULT_PROVIDER: CloudProviderId = "onedrive";

const decodeRouteKey = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const buildSharedRouteKey = (providerId: CloudProviderId, sharedId: string): string =>
  `${providerId}:${sharedId}`;

export const parseSharedRouteKey = (
  raw: string,
): { providerId: CloudProviderId; sharedId: string } => {
  const routeKey = decodeRouteKey(raw);
  const separatorIndex = routeKey.indexOf(":");
  if (separatorIndex <= 0) {
    return { providerId: DEFAULT_PROVIDER, sharedId: routeKey };
  }
  const providerCandidate = routeKey.slice(0, separatorIndex) as CloudProviderId;
  const sharedId = routeKey.slice(separatorIndex + 1);
  if (providerCandidate !== "onedrive" && providerCandidate !== "gdrive") {
    return { providerId: DEFAULT_PROVIDER, sharedId: routeKey };
  }
  return { providerId: providerCandidate, sharedId };
};
