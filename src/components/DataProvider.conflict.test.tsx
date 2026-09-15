import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { PersonalDataProvider, usePersonalData } from "./PersonalDataProvider";
import { SharedDataProvider, useSharedData } from "./SharedDataProvider";
import { GraphError } from "@/lib/graph/graphErrors";
import type { EventIndex } from "@/lib/persistence/eventIndex";
import { parseEventChunk } from "@/lib/persistence/eventChunk";
import { createEmptySnapshot, type Snapshot } from "@/lib/persistence/snapshot";
import {
  readSnapshotCache,
  writeSnapshotCache,
  type CachedSnapshot,
} from "@/lib/persistence/snapshotCache";
import type { StorageService } from "@/lib/storage/storageService";
import type { CloudProviderId } from "@/lib/storage/types";

jest.mock("next/navigation", () => ({ usePathname: () => "/accounts" }));
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockAuth }));
jest.mock("@/components/StorageProviderContext", () => ({
  useStorageProviderContext: () => ({
    activeProviderId: mockProviderId,
    setActiveProviderId: mockSetProvider,
  }),
}));
jest.mock("@/components/SharedSelectionProvider", () => ({
  useSharedSelection: () => ({ selection: null, setSelection: mockSetSelection }),
}));
jest.mock("@/lib/storage/storageService", () => ({ createStorageService: () => mockStorage }));
jest.mock("@/lib/persistence/snapshotCache", () => ({
  readSnapshotCache: jest.fn(),
  writeSnapshotCache: jest.fn(),
}));
jest.mock("@/lib/lease/deviceId", () => ({ getDeviceId: () => "test-device" }));
jest.mock("@/lib/persistence/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
jest.mock("@/lib/persistence/syncSignalStore", () => ({
  buildPersonalSyncSignalKey: () => "test-personal",
  buildSharedSyncSignalKey: () => "test-shared",
  upsertSyncSignal: jest.fn(),
  clearSyncSignal: jest.fn(),
}));

let mockProviderId: CloudProviderId = "onedrive";
const mockSetProvider = jest.fn();
const mockSetSelection = jest.fn();
const mockSession = { status: "signed_in", account: { name: "Test user" } };
const mockAuth = {
  providers: { onedrive: mockSession, gdrive: mockSession },
  getAccessToken: jest.fn(),
};
let mockStorage: Partial<StorageService>;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe.each(["onedrive", "gdrive"] as const)("%s conflict recovery", (providerId) => {
  describe.each(["personal", "shared"] as const)("%s workspace", (scope) => {
    let snapshot: Snapshot;
    let generation: number;
    let cache: Map<string, CachedSnapshot>;
    let chunks: Map<number, string>;
    let index: EventIndex | null;
    const read = jest.fn<ReturnType<StorageService["readPersonalSnapshot"]>, []>();
    const write = jest.fn<
      ReturnType<StorageService["writePersonalSnapshot"]>,
      Parameters<StorageService["writePersonalSnapshot"]>
    >();

    beforeEach(() => {
      jest.clearAllMocks();
      mockProviderId = providerId;
      snapshot = createEmptySnapshot("2026-01-01T00:00:00.000Z");
      generation = 1;
      cache = new Map();
      chunks = new Map();
      index = null;
      jest
        .mocked(readSnapshotCache)
        .mockReset()
        .mockImplementation(async (key) => copy(cache.get(key) ?? null));
      jest
        .mocked(writeSnapshotCache)
        .mockReset()
        .mockImplementation(async (record) => {
          cache.set(record.key, copy(record));
        });
      read.mockReset().mockImplementation(async () => ({
        snapshot: copy(snapshot),
        etag: `"${generation}"`,
        lastModified: snapshot.updatedAt,
      }));
      write.mockReset().mockImplementation(async (next, options) => {
        if (options?.ifMatch !== `"${generation}"`) {
          throw new GraphError("Generation conflict.", {
            status: 412,
            code: "precondition_failed",
          });
        }
        snapshot = copy(next);
        return { etag: `"${++generation}"` };
      });
      const readChunk = async (id: number) => {
        const content = chunks.get(id);
        if (!content) throw new Error("Missing test chunk.");
        return content;
      };
      mockStorage = {
        ensureAppRoot: async () => undefined,
        ensureEventsFolder: async () => undefined,
        ensureSharedEventsFolder: async () => undefined,
        readPersonalSnapshot: read,
        writePersonalSnapshot: write,
        readSharedSnapshot: () => read(),
        writeSharedSnapshot: (_, next, options) => write(next, options),
        readPersonalLease: async () => null,
        readSharedLease: async () => null,
        writePersonalLease: async () => undefined,
        writeSharedLease: async () => undefined,
        listEventChunkIds: async () => [...chunks.keys()],
        listSharedEventChunkIds: async () => [...chunks.keys()],
        readEventChunk: readChunk,
        readSharedEventChunk: (_, id) => readChunk(id),
        writeEventChunk: async (id, content) => {
          chunks.set(id, content);
        },
        writeSharedEventChunk: async (_, id, content) => {
          chunks.set(id, content);
        },
        readEventIndex: async () => index,
        readSharedEventIndex: async () => index,
        writeEventIndex: async (next) => {
          index = next;
        },
        writeSharedEventIndex: async (_, next) => {
          index = next;
        },
        getSharedRootInfo: async (root) => ({
          ...root,
          name: "Test shared workspace",
          canWrite: true,
          isFolder: true,
        }),
      };
    });

    async function mount() {
      const Wrapper = ({ children }: { children: ReactNode }) =>
        scope === "personal" ? (
          <PersonalDataProvider>{children}</PersonalDataProvider>
        ) : (
          <SharedDataProvider sharedId={`${providerId}:drive_root`}>{children}</SharedDataProvider>
        );
      const device = renderHook(scope === "personal" ? usePersonalData : useSharedData, {
        wrapper: Wrapper,
      });
      await waitFor(() => {
        expect(device.result.current.status).toBe("ready");
        expect(device.result.current.canWrite).toBe(true);
      });
      return device;
    }

    async function createConflict() {
      const a = await mount();
      const b = await mount();
      act(() => {
        expect(a.result.current.createAccount("Winner").ok).toBe(true);
        expect(b.result.current.createAccount("Loser").ok).toBe(true);
      });
      await act(async () => {
        expect(await a.result.current.saveChanges()).toEqual({ ok: true });
      });
      return b;
    }

    it("replaces losing edits and allows the next save with the new generation", async () => {
      const b = await createConflict();
      await act(async () => {
        expect(await b.result.current.saveChanges()).toEqual({ ok: false, reason: "conflict" });
      });
      expect(b.result.current.isDirty).toBe(false);
      expect(b.result.current.snapshot).toEqual(snapshot);
      expect(b.result.current.draftState).toEqual(snapshot.stateJson);
      expect(
        b.result.current.latestEvent?.payload.name ??
          b.result.current.latestEvent?.payload.accountName,
      ).toBe("Winner");
      expect([...cache.values()].every((record) => record.snapshot.version === 2)).toBe(true);
      act(() => {
        expect(b.result.current.createAccount("After reload").ok).toBe(true);
      });
      await act(async () => {
        expect(await b.result.current.saveChanges()).toEqual({ ok: true });
      });
      expect(write.mock.calls.at(-1)?.[1]?.ifMatch).toBe('"2"');
      expect(snapshot.stateJson.accounts.map((account) => account.name)).toEqual([
        "Winner",
        "After reload",
      ]);
      const events = [...chunks.values()].flatMap((content) => parseEventChunk(content).events);
      expect(events).toHaveLength(2);
      expect(JSON.stringify(events)).not.toContain("Loser");
      expect(read).toHaveBeenCalledTimes(3);
    });

    it.each([
      new GraphError("Network unavailable.", { status: null, code: "network_error" }),
      new GraphError("Snapshot removed.", { status: 404, code: "not_found" }),
    ])("does not claim recovery or recreate a snapshot when reloading fails: %s", async (error) => {
      const b = await createConflict();
      read.mockRejectedValueOnce(error);
      await act(async () => {
        expect(await b.result.current.saveChanges()).toMatchObject({
          ok: false,
          reason: "error",
          error: expect.stringContaining("latest data could not be loaded"),
        });
      });
      expect(b.result.current.isDirty).toBe(true);
      expect(b.result.current.snapshot?.version).toBe(1);
      expect(b.result.current.message ?? "").not.toContain("Reloaded");
      expect(write).toHaveBeenCalledTimes(2);
      expect(snapshot.version).toBe(2);
      await act(async () => {
        expect(await b.result.current.saveChanges()).toEqual({ ok: false, reason: "conflict" });
      });
      expect(b.result.current.draftState).toEqual(snapshot.stateJson);
      expect(b.result.current.isDirty).toBe(false);
    });

    it("does not claim recovery when the refreshed snapshot cannot be cached", async () => {
      const b = await createConflict();
      jest.mocked(writeSnapshotCache).mockRejectedValueOnce(new Error("Cache unavailable."));
      await act(async () => {
        expect(await b.result.current.saveChanges()).toMatchObject({ ok: false, reason: "error" });
      });
      expect(b.result.current.snapshot?.version).toBe(1);
      expect(b.result.current.isDirty).toBe(true);
      expect(snapshot.version).toBe(2);
    });

    it("keeps protecting pending edits during an ordinary refresh", async () => {
      const b = await createConflict();
      read.mockClear();
      await act(async () => {
        await b.result.current.refresh();
      });
      expect(read).not.toHaveBeenCalled();
      expect(b.result.current.isDirty).toBe(true);
      expect(b.result.current.draftState?.accounts[0].name).toBe("Loser");
    });
  });
});
