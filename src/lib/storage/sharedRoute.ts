import type { CloudProviderId } from "./types";

const DEFAULT_PROVIDER: CloudProviderId = "onedrive";

export const buildSharedRouteKey = (providerId: CloudProviderId, sharedId: string): string =>
  `${providerId}:${sharedId}`;

export const parseSharedRouteKey = (
  raw: string,
): { providerId: CloudProviderId; sharedId: string } => {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) {
    return { providerId: DEFAULT_PROVIDER, sharedId: raw };
  }
  const providerCandidate = raw.slice(0, separatorIndex) as CloudProviderId;
  const sharedId = raw.slice(separatorIndex + 1);
  if (providerCandidate !== "onedrive" && providerCandidate !== "gdrive") {
    return { providerId: DEFAULT_PROVIDER, sharedId: raw };
  }
  return { providerId: providerCandidate, sharedId };
};
