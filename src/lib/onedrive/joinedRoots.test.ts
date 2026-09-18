import { TextEncoder } from "util";
import { createGraphClient } from "@/lib/graph/graphClient";
import { GraphError } from "@/lib/graph/graphErrors";
import { createOneDriveService } from "./oneDriveService";
import { encodeOneDriveSharingUrl, readJoinedRoots, forgetJoinedRoot } from "./joinedRoots";

Object.assign(globalThis, { TextEncoder });
const snapshot = JSON.stringify({
  version: 1,
  updatedAt: "2026-09-18T00:00:00Z",
  stateJson: { accounts: [], positions: [], goals: [], allocations: [] },
});
const root = { id: "root", name: "Family", folder: {}, parentReference: { driveId: "owner" } };

function setup() {
  const client = createGraphClient({
    accessTokenProvider: async () => {
      throw new Error("No network.");
    },
  });
  const get = jest
    .spyOn(client, "getJson")
    .mockImplementation(async (path) => (path.startsWith("/me?") ? { id: "member-a" } : root));
  const read = jest.spyOn(client, "getText").mockResolvedValue(snapshot);
  return {
    service: createOneDriveService(client, ["Files.ReadWrite", "User.Read"]),
    client,
    get,
    read,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

it("redeems explicitly, validates direct access, and remembers IDs without the link", async () => {
  const { service, get, read } = setup();
  const result = await service.joinSharedRootByLink("https://1drv.ms/f/synthetic?secret=link-key");
  expect(result.sharedId).toBe("owner_root");
  expect(get.mock.calls[1]).toEqual([
    expect.stringMatching(/^\/shares\/u!/),
    ["Files.ReadWrite", "User.Read"],
    { prefer: "redeemSharingLink" },
  ]);
  expect(get.mock.calls[2][0]).toBe("/drives/owner/items/root");
  expect(read.mock.calls[0][0]).toBe("/drives/owner/items/root:/snapshot-shared.json:/content");
  expect(await service.listSharedWithMeRoots()).toHaveLength(1);
  expect(JSON.stringify(localStorage)).not.toContain("link-key");
  expect(get.mock.calls.some(([path]) => path.includes("sharedWithMe"))).toBe(false);
  forgetJoinedRoot("member-a", result.sharedId);
  expect(await service.listSharedWithMeRoots()).toEqual([]);
});

it("normalizes remote items and isolates accounts even when the service is reused", async () => {
  const { service, get } = setup();
  get.mockImplementation(async (path) =>
    path.startsWith("/me?")
      ? { id: "member-a" }
      : path.startsWith("/shares/")
        ? { id: "shortcut", remoteItem: root }
        : root,
  );
  await service.joinSharedRootByLink("https://onedrive.live.com/?id=synthetic");
  get.mockResolvedValue({ id: "member-b" });
  expect(await service.listSharedWithMeRoots()).toEqual([]);
  expect(readJoinedRoots("member-a")).toHaveLength(1);
});

it.each([
  "https://evil.example/folder",
  "http://1drv.ms/a",
  "https://1drv.ms.evil.example/a",
  "https://user:password@1drv.ms/a",
  "https://1drv.ms:444/a",
  "invalid",
])("rejects %s before any request", async (url) => {
  const { service, get } = setup();
  await expect(service.joinSharedRootByLink(url)).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});

it.each(["forbidden", "missing", "invalid"])(
  "does not remember an inaccessible or invalid snapshot: %s",
  async (mode) => {
    const { service, read } = setup();
    if (mode === "invalid") read.mockResolvedValue("{}");
    else read.mockRejectedValue(new Error(mode));
    await expect(service.joinSharedRootByLink("https://1drv.ms/a")).rejects.toThrow();
    expect(readJoinedRoots("member-a")).toEqual([]);
  },
);

it("does not store a root when the account changes during joining", async () => {
  const { service, get } = setup();
  let calls = 0;
  get.mockImplementation(async (path) =>
    path.startsWith("/me?") ? { id: ++calls === 1 ? "member-a" : "member-b" } : root,
  );
  await expect(service.joinSharedRootByLink("https://1drv.ms/a")).rejects.toThrow(
    "account changed",
  );
  expect(readJoinedRoots("member-a")).toEqual([]);
  expect(readJoinedRoots("member-b")).toEqual([]);
});

it("reports a local storage failure instead of claiming durable membership", async () => {
  const { service } = setup();
  const put = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  await expect(service.joinSharedRootByLink("https://1drv.ms/a")).rejects.toThrow("Quota");
  put.mockRestore();
});

it("encodes Unicode as UTF-8 with the Graph sharing token prefix", () => {
  const token = encodeOneDriveSharingUrl("https://1drv.ms/f/例");
  expect(token.startsWith("u!")).toBe(true);
  expect(token).not.toMatch(/[+/=]/);
});

it("does not expose a missing joined snapshot as a new-workspace initialization signal", async () => {
  const { service, client } = setup();
  await service.joinSharedRootByLink("https://1drv.ms/a");
  jest
    .spyOn(client, "getTextWithHeaders")
    .mockRejectedValue(new GraphError("Missing", { status: 404, code: "not_found" }));
  await expect(
    service.readSharedSnapshot({ sharedId: "owner_root", driveId: "owner", itemId: "root" }),
  ).rejects.toThrow("no data was recreated");
});
