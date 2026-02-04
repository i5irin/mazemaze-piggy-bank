import { serializeEventChunk, type EventChunk, type StoredEvent } from "./eventChunk";
import { createHistoryLoader } from "./history";

const makeChunk = (chunk: EventChunk): string => serializeEventChunk(chunk);

const makeEvent = (input: {
  id: string;
  type: string;
  createdAt: string;
  version: number;
  payload: Record<string, unknown>;
}): StoredEvent => ({
  id: input.id,
  type: input.type,
  createdAt: input.createdAt,
  version: input.version,
  payload: input.payload,
});

describe("createHistoryLoader", () => {
  it("paginates filtered goal history without loading all events", async () => {
    const chunks = new Map<number, string>([
      [
        1,
        makeChunk({
          chunkId: 1,
          fromVersion: 1,
          toVersion: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          events: [
            makeEvent({
              id: "e-1",
              type: "allocation_created",
              createdAt: "2026-01-01T00:00:01.000Z",
              version: 1,
              payload: { goalId: "g-1", positionId: "p-1", amount: 1000 },
            }),
            makeEvent({
              id: "e-2",
              type: "goal_updated",
              createdAt: "2026-01-01T00:00:02.000Z",
              version: 2,
              payload: { goalId: "g-2", targetAmount: 3000 },
            }),
          ],
        }),
      ],
      [
        2,
        makeChunk({
          chunkId: 2,
          fromVersion: 3,
          toVersion: 4,
          createdAt: "2026-01-02T00:00:00.000Z",
          events: [
            makeEvent({
              id: "e-3",
              type: "allocation_updated",
              createdAt: "2026-01-02T00:00:01.000Z",
              version: 3,
              payload: { goalId: "g-1", positionId: "p-1", amount: 2000 },
            }),
            makeEvent({
              id: "e-4",
              type: "goal_spent",
              createdAt: "2026-01-02T00:00:02.000Z",
              version: 4,
              payload: {
                goalId: "g-1",
                totalAmount: 2000,
                payments: [{ positionId: "p-1", amount: 2000 }],
              },
            }),
          ],
        }),
      ],
    ]);

    const loader = createHistoryLoader({
      listChunkIds: async () => [1, 2],
      readChunk: async (chunkId: number) => {
        const value = chunks.get(chunkId);
        if (!value) {
          throw new Error("chunk missing");
        }
        return value;
      },
    });

    const firstPage = await loader({
      limit: 2,
      filter: { goalId: "g-1" },
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0].id).toBe("e-4:4");
    expect(firstPage.items[0].origin).toBe("user");
    expect(firstPage.items[1].id).toBe("e-3:3");
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await loader({
      limit: 2,
      filter: { goalId: "g-1" },
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).toBe("e-1:1");
    expect(secondPage.nextCursor).toBeNull();
  });

  it("filters position history by nested payload references", async () => {
    const chunks = new Map<number, string>([
      [
        3,
        makeChunk({
          chunkId: 3,
          fromVersion: 5,
          toVersion: 6,
          createdAt: "2026-01-03T00:00:00.000Z",
          events: [
            makeEvent({
              id: "e-5",
              type: "goal_spent",
              createdAt: "2026-01-03T00:00:01.000Z",
              version: 5,
              payload: {
                goalId: "g-2",
                totalAmount: 3500,
                payments: [
                  { positionId: "p-2", amount: 1500 },
                  { positionId: "p-3", amount: 2000 },
                ],
              },
            }),
            makeEvent({
              id: "e-6",
              type: "state_repaired",
              createdAt: "2026-01-03T00:00:02.000Z",
              version: 6,
              payload: {},
            }),
          ],
        }),
      ],
    ]);

    const loader = createHistoryLoader({
      listChunkIds: async () => [3],
      readChunk: async (chunkId: number) => {
        const value = chunks.get(chunkId);
        if (!value) {
          throw new Error("chunk missing");
        }
        return value;
      },
    });

    const page = await loader({
      limit: 20,
      filter: { positionId: "p-3" },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe("e-5:5");
    expect(page.nextCursor).toBeNull();
  });

  it("limits chunk scans per request and returns a continuation cursor", async () => {
    const chunks = new Map<number, string>();
    for (let chunkId = 1; chunkId <= 10; chunkId += 1) {
      const event =
        chunkId === 1
          ? makeEvent({
              id: "target",
              type: "position_updated",
              createdAt: "2026-01-10T00:00:00.000Z",
              version: chunkId,
              payload: { positionId: "p-target", marketValue: 1234 },
            })
          : makeEvent({
              id: `e-${chunkId}`,
              type: "goal_updated",
              createdAt: `2026-01-${String(chunkId).padStart(2, "0")}T00:00:00.000Z`,
              version: chunkId,
              payload: { goalId: `g-${chunkId}`, targetAmount: 1000 + chunkId },
            });
      chunks.set(
        chunkId,
        makeChunk({
          chunkId,
          fromVersion: chunkId,
          toVersion: chunkId,
          createdAt: "2026-01-01T00:00:00.000Z",
          events: [event],
        }),
      );
    }

    const loader = createHistoryLoader({
      listChunkIds: async () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      readChunk: async (chunkId: number) => {
        const value = chunks.get(chunkId);
        if (!value) {
          throw new Error("chunk missing");
        }
        return value;
      },
    });

    const firstPage = await loader({
      limit: 20,
      filter: { positionId: "p-target" },
    });
    expect(firstPage.items).toHaveLength(0);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await loader({
      limit: 20,
      filter: { positionId: "p-target" },
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).toBe("target:1");
    expect(secondPage.nextCursor).toBeNull();
  });
});
