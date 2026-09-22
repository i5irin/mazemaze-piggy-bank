import { serializeEventChunk, type EventChunk } from "./eventChunk";
import {
  buildEventIndexEntries,
  mergeEventIndex,
  parseEventIndex,
  refreshEventIndex,
  type EventIndex,
} from "./eventIndex";
import { createHistoryLoader } from "./history";

const makeChunk = (chunkId: number, goalId = `goal-${chunkId}`): EventChunk => ({
  chunkId,
  fromVersion: chunkId,
  toVersion: chunkId,
  createdAt: "2026-09-14T00:00:00Z",
  events: [
    {
      id: `event-${chunkId}`,
      type: "allocation_created",
      version: chunkId,
      createdAt: "2026-09-14T00:00:00Z",
      payload: { goalId, positionId: "position-1", amount: 100 },
    },
  ],
});

const makeIndex = (chunks: EventChunk[], version: number) =>
  mergeEventIndex(null, buildEventIndexEntries(chunks), {
    updatedAt: "2026-09-14T00:00:00Z",
    lastEventVersion: version,
  });

const makeSource = (chunks: EventChunk[], initialIndex: EventIndex | null = null) => {
  let index = initialIndex;
  return {
    listChunkIds: jest.fn(async () => chunks.map((chunk) => chunk.chunkId)),
    readChunk: jest.fn(async (id: number) => {
      const chunk = chunks.find((item) => item.chunkId === id);
      if (!chunk) throw new Error("Missing chunk.");
      return serializeEventChunk(chunk);
    }),
    readIndex: jest.fn(async () => index),
    writeIndex: jest.fn(async (next: EventIndex) => {
      index = next;
    }),
    getSnapshotVersion: () => Math.max(0, ...chunks.map((chunk) => chunk.toVersion)),
  };
};

describe("event index recovery", () => {
  it("fills gaps left by an index write failure on the next successful refresh", async () => {
    const chunks = [makeChunk(1), makeChunk(2), makeChunk(3)];
    const source = makeSource(chunks, makeIndex([chunks[0]], 1));
    source.writeIndex.mockRejectedValueOnce(new Error("Offline."));
    await refreshEventIndex(source);
    expect((await source.readIndex())?.lastEventVersion).toBe(1);
    const fallback = await createHistoryLoader(source)({ limit: 20, filter: { goalId: "goal-2" } });
    expect(fallback.items).toHaveLength(1);
    await refreshEventIndex(source);
    expect((await source.readIndex())?.chunks.map((chunk) => chunk.chunkId)).toEqual([1, 2, 3]);
    const page = await createHistoryLoader(source)({ limit: 20, filter: { goalId: "goal-2" } });
    expect(page.items).toHaveLength(1);
  });

  it("indexes all persisted chunks after a partial upload is retried", async () => {
    const chunks = [makeChunk(1)];
    const source = makeSource(chunks);
    await refreshEventIndex(source);
    chunks.push(makeChunk(2), makeChunk(3));
    await refreshEventIndex(source);
    expect((await source.readIndex())?.lastEventVersion).toBe(3);
    expect((await source.readIndex())?.chunks).toHaveLength(3);
  });

  it("does not publish a partial index when a missing chunk cannot be read", async () => {
    const source = makeSource([makeChunk(1), makeChunk(2)]);
    source.readChunk.mockRejectedValueOnce(new Error("Unavailable."));
    await refreshEventIndex(source);
    expect(source.writeIndex).not.toHaveBeenCalled();
    await refreshEventIndex(source);
    expect((await source.readIndex())?.chunks).toHaveLength(2);
  });

  it("rebuilds from replacement chunks after Import or Move invalidates the index", async () => {
    const source = makeSource([makeChunk(1, "imported-goal")]);
    await refreshEventIndex(source);
    const page = await createHistoryLoader(source)({
      limit: 20,
      filter: { goalId: "imported-goal" },
    });
    expect(page.items).toHaveLength(1);
    expect((await source.readIndex())?.chunks[0].goalIds).toEqual(["imported-goal"]);
  });
});

describe("history index validation", () => {
  it("falls back when a latest-version index omits persisted chunks", async () => {
    const chunks = [makeChunk(1), makeChunk(2)];
    const source = makeSource(chunks, makeIndex([chunks[1]], 2));
    const page = await createHistoryLoader(source)({ limit: 20, filter: { goalId: "goal-1" } });
    expect(page.items).toHaveLength(1);
    expect(source.readChunk).toHaveBeenCalledWith(1);
  });

  it("rejects an index ahead of the snapshot after replacement", async () => {
    const source = makeSource([makeChunk(1, "new-goal")], makeIndex([makeChunk(2)], 2));
    const page = await createHistoryLoader(source)({ limit: 20, filter: { goalId: "new-goal" } });
    expect(page.items).toHaveLength(1);
    expect(source.readChunk).not.toHaveBeenCalledWith(2);
  });

  it("uses a complete index to skip unrelated chunks and paginate", async () => {
    const chunks = [makeChunk(1, "target"), makeChunk(2), makeChunk(3, "target")];
    const source = makeSource(chunks, makeIndex(chunks, 3));
    const loader = createHistoryLoader(source);
    const first = await loader({ limit: 1, filter: { goalId: "target" } });
    const next = await loader({ limit: 1, filter: { goalId: "target" }, cursor: first.nextCursor });
    expect(first.items[0].id).toBe("event-3:3");
    expect(next.items[0].id).toBe("event-1:1");
    expect(source.readChunk).not.toHaveBeenCalledWith(2);
  });

  it("retries once without the index when an indexed file becomes unavailable", async () => {
    const chunks = [makeChunk(1)];
    const source = makeSource(chunks, makeIndex(chunks, 1));
    source.readChunk.mockRejectedValueOnce(new Error("File changed."));
    const page = await createHistoryLoader(source)({ limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(source.readIndex).toHaveBeenCalledTimes(1);
    expect(source.readChunk).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed numeric ranges and duplicate chunk IDs", () => {
    const index = makeIndex([makeChunk(1)], 1);
    expect(parseEventIndex(index)).not.toBeNull();
    expect(parseEventIndex({ ...index, lastEventVersion: -1 })).toBeNull();
    expect(parseEventIndex({ ...index, chunks: [...index.chunks, ...index.chunks] })).toBeNull();
    for (const change of [
      { chunkId: 1.5 },
      { eventCount: 2 },
      { fromVersion: 2 },
      { toVersion: 2 },
    ]) {
      expect(parseEventIndex({ ...index, chunks: [{ ...index.chunks[0], ...change }] })).toBeNull();
    }
  });
});
