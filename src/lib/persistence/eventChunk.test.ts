import {
  assignEventVersions,
  buildEventChunks,
  parseEventChunk,
  serializeEventChunk,
} from "./eventChunk";

describe("eventChunk helpers", () => {
  it("assigns versions and serializes JSONL", () => {
    const events = [
      { id: "e-1", type: "demo", payload: { delta: 1 }, createdAt: "2025-01-01T00:00:00Z" },
      { id: "e-2", type: "demo", payload: { delta: 2 }, createdAt: "2025-01-01T00:01:00Z" },
    ];

    const versioned = assignEventVersions(events, 10);
    expect(versioned[0].version).toBe(11);
    expect(versioned[1].version).toBe(12);

    const chunks = buildEventChunks(versioned, 3, 500, "2025-01-02T00:00:00Z");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].fromVersion).toBe(11);
    expect(chunks[0].toVersion).toBe(12);

    const content = serializeEventChunk(chunks[0]);
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    const header = JSON.parse(lines[0]);
    expect(header.chunkId).toBe(3);
    expect(header.fromVersion).toBe(11);
    expect(header.toVersion).toBe(12);
  });

  it("parses serialized chunks", () => {
    const events = [
      { id: "e-1", type: "demo", payload: { delta: 1 }, createdAt: "2025-01-01T00:00:00Z" },
      { id: "e-2", type: "demo", payload: { delta: 2 }, createdAt: "2025-01-01T00:01:00Z" },
    ];
    const versioned = assignEventVersions(events, 5);
    const chunks = buildEventChunks(versioned, 10, 500, "2025-01-02T00:00:00Z");
    const content = serializeEventChunk(chunks[0]);
    const parsed = parseEventChunk(content);
    expect(parsed.chunkId).toBe(10);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].id).toBe("e-1");
  });
});
