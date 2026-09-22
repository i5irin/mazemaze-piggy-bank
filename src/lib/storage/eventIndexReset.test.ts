import { createGraphClient } from "@/lib/graph/graphClient";
import { createGoogleDriveClient } from "@/lib/google/googleDriveClient";
import { createGoogleDriveService } from "@/lib/google/googleDriveService";
import { createOneDriveService } from "@/lib/onedrive/oneDriveService";

const noToken = async (): Promise<string> => {
  throw new Error("Network access is forbidden in this test.");
};

describe("event replacement invalidation", () => {
  it("lists every OneDrive event page for index coverage checks", async () => {
    const client = createGraphClient({ accessTokenProvider: noToken });
    const list = jest
      .spyOn(client, "getJson")
      .mockResolvedValueOnce({
        value: [{ name: "event-1.jsonl" }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/drives/drive/items/events/children?$skiptoken=next",
      })
      .mockResolvedValueOnce({ value: [{ name: "event-2.jsonl" }] });
    const storage = createOneDriveService(client, []);
    expect(
      await storage.listSharedEventChunkIds({ sharedId: "test", driveId: "drive", itemId: "root" }),
    ).toEqual([1, 2]);
    expect(list.mock.calls[1][0]).toBe("/drives/drive/items/events/children?$skiptoken=next");
  });

  it("lists every Google event page for index coverage checks", async () => {
    const client = createGoogleDriveClient({ accessTokenProvider: noToken });
    const list = jest
      .spyOn(client, "getJson")
      .mockResolvedValueOnce({ files: [{ id: "events", name: "events" }] })
      .mockResolvedValueOnce({
        files: [{ id: "first", name: "event-1.jsonl" }],
        nextPageToken: "next",
      })
      .mockResolvedValueOnce({ files: [{ id: "second", name: "event-2.jsonl" }] });
    const storage = createGoogleDriveService(client, []);
    expect(await storage.listSharedEventChunkIds({ sharedId: "test", fileId: "root" })).toEqual([
      1, 2,
    ]);
    expect(list.mock.calls[2][2]).toMatchObject({ pageToken: "next" });
  });

  it("deletes the OneDrive index before deleting shared event files", async () => {
    const client = createGraphClient({ accessTokenProvider: noToken });
    jest.spyOn(client, "getJson").mockResolvedValue({ value: [{ name: "event-1.jsonl" }] });
    const remove = jest.spyOn(client, "delete").mockResolvedValue(undefined);
    const storage = createOneDriveService(client, []);
    await storage.deleteAllSharedEventChunks({
      sharedId: "test",
      driveId: "drive",
      itemId: "root",
    });
    expect(remove.mock.calls[0][0]).toContain("index.json");
    expect(remove.mock.calls[1][0]).toContain("event-1.jsonl");
  });

  it("aborts OneDrive replacement if invalidation fails", async () => {
    const client = createGraphClient({ accessTokenProvider: noToken });
    const remove = jest.spyOn(client, "delete").mockRejectedValue(new Error("No access."));
    const storage = createOneDriveService(client, []);
    await expect(
      storage.deleteAllSharedEventChunks({ sharedId: "test", driveId: "drive", itemId: "root" }),
    ).rejects.toThrow("No access.");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("deletes the Google index before deleting shared event files", async () => {
    const client = createGoogleDriveClient({ accessTokenProvider: noToken });
    jest
      .spyOn(client, "getJson")
      .mockResolvedValueOnce({ files: [{ id: "events", name: "events" }] })
      .mockResolvedValueOnce({ files: [{ id: "index", name: "index.json" }] })
      .mockResolvedValueOnce({
        files: [
          { id: "event", name: "event-1.jsonl" },
          { id: "other", name: "notes.txt" },
        ],
      });
    const remove = jest.spyOn(client, "delete").mockResolvedValue(undefined);
    const storage = createGoogleDriveService(client, []);
    await storage.deleteAllSharedEventChunks({ sharedId: "test", fileId: "root" });
    expect(remove.mock.calls.map(([path]) => path)).toEqual([
      "/files/index?supportsAllDrives=true",
      "/files/event?supportsAllDrives=true",
    ]);
  });

  it("does not create folders when reading an absent shared Google index", async () => {
    const client = createGoogleDriveClient({ accessTokenProvider: noToken });
    jest.spyOn(client, "getJson").mockResolvedValue({ files: [] });
    const create = jest.spyOn(client, "postJson");
    const storage = createGoogleDriveService(client, []);
    expect(await storage.readSharedEventIndex({ sharedId: "test", fileId: "root" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
