export type CloudProviderId = "onedrive" | "gdrive";

export type ProviderAccount = {
  name: string;
  email: string;
};

export type ShareLinkPermission = "view" | "edit";

export type ShareLinkResult = {
  permission: ShareLinkPermission;
  webUrl: string;
};

export type SharedRootReference = {
  providerId: CloudProviderId;
  sharedId: string;
  driveId?: string;
  itemId?: string;
};

export type SharedRootInfo = SharedRootReference & {
  name: string;
  webUrl?: string;
  canWrite: boolean;
  isFolder: boolean;
};

export type SharedRootListItem = SharedRootReference & {
  name: string;
  webUrl?: string;
  isFolder: boolean;
};

export type StorageCapabilities = {
  supportsShared: boolean;
  supportsShareLinks: boolean;
};

export type RootFolderNotice = {
  scope: "app" | "personal" | "shared";
  expectedName: string;
  actualName: string;
};
