import { buildSharedRouteKey, parseSharedRouteKey } from "./sharedRoute";

describe("shared route keys", () => {
  it("parses a decoded OneDrive route key", () => {
    expect(parseSharedRouteKey("onedrive:drive_item")).toEqual({
      providerId: "onedrive",
      sharedId: "drive_item",
    });
  });

  it("decodes an encoded OneDrive route segment before parsing it", () => {
    expect(parseSharedRouteKey("onedrive%3Adrive_item")).toEqual({
      providerId: "onedrive",
      sharedId: "drive_item",
    });
  });

  it("decodes an encoded Google Drive route segment before parsing it", () => {
    expect(parseSharedRouteKey("gdrive%3Agoogle-item")).toEqual({
      providerId: "gdrive",
      sharedId: "google-item",
    });
  });

  it("keeps legacy provider-less route keys on OneDrive", () => {
    expect(parseSharedRouteKey("drive_item")).toEqual({
      providerId: "onedrive",
      sharedId: "drive_item",
    });
  });

  it("does not throw for malformed URL encoding", () => {
    expect(parseSharedRouteKey("drive%item")).toEqual({
      providerId: "onedrive",
      sharedId: "drive%item",
    });
  });

  it("builds a provider-qualified route key", () => {
    expect(buildSharedRouteKey("onedrive", "drive_item")).toBe("onedrive:drive_item");
  });
});
