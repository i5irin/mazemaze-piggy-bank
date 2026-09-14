import { parseEventChunk, type EventChunk, type StoredEvent } from "./eventChunk";

export const EVENT_INDEX_SCHEMA_VERSION = 1;

export type EventIndexChunk = {
  chunkId: number;
  fromVersion: number;
  toVersion: number;
  eventCount: number;
  goalIds: string[];
  positionIds: string[];
  fileId?: string;
};

export type EventIndex = {
  schemaVersion: number;
  updatedAt: string;
  lastEventVersion: number;
  chunks: EventIndexChunk[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const readStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    result.push(item);
  }
  return result;
};

const appendDirectId = (collection: string[], payload: Record<string, unknown>, key: string) => {
  const value = asString(payload[key]);
  if (value) {
    collection.push(value);
  }
};

const appendIdArray = (collection: string[], payload: Record<string, unknown>, key: string) => {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    const parsed = asString(item);
    if (parsed) {
      collection.push(parsed);
    }
  }
};

const appendNestedIds = (
  collection: string[],
  payload: Record<string, unknown>,
  arrayKey: string,
  nestedKey: string,
) => {
  const value = payload[arrayKey];
  if (!Array.isArray(value)) {
    return;
  }
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const parsed = asString(item[nestedKey]);
    if (parsed) {
      collection.push(parsed);
    }
  }
};

const uniqueSorted = (values: string[]): string[] => Array.from(new Set(values)).sort();

const collectGoalIds = (event: StoredEvent): string[] => {
  if (!isRecord(event.payload)) {
    return [];
  }
  const payload = event.payload;
  const ids: string[] = [];
  appendDirectId(ids, payload, "goalId");
  appendIdArray(ids, payload, "goalIds");
  appendIdArray(ids, payload, "affectedGoalIds");
  appendNestedIds(ids, payload, "allocations", "goalId");
  return uniqueSorted(ids);
};

const collectPositionIds = (event: StoredEvent): string[] => {
  if (!isRecord(event.payload)) {
    return [];
  }
  const payload = event.payload;
  const ids: string[] = [];
  appendDirectId(ids, payload, "positionId");
  appendIdArray(ids, payload, "positionIds");
  appendIdArray(ids, payload, "affectedPositionIds");
  appendNestedIds(ids, payload, "allocations", "positionId");
  appendNestedIds(ids, payload, "payments", "positionId");
  appendNestedIds(ids, payload, "positions", "id");
  return uniqueSorted(ids);
};

export const buildEventIndexEntries = (chunks: EventChunk[]): EventIndexChunk[] =>
  chunks.map((chunk) => {
    const goalIds = new Set<string>();
    const positionIds = new Set<string>();
    for (const event of chunk.events) {
      for (const goalId of collectGoalIds(event)) {
        goalIds.add(goalId);
      }
      for (const positionId of collectPositionIds(event)) {
        positionIds.add(positionId);
      }
    }
    return {
      chunkId: chunk.chunkId,
      fromVersion: chunk.fromVersion,
      toVersion: chunk.toVersion,
      eventCount: chunk.events.length,
      goalIds: Array.from(goalIds).sort(),
      positionIds: Array.from(positionIds).sort(),
    };
  });

export const mergeEventIndex = (
  existing: EventIndex | null,
  updates: EventIndexChunk[],
  options: { updatedAt: string; lastEventVersion: number },
): EventIndex => {
  const nextById = new Map<number, EventIndexChunk>();
  if (existing) {
    for (const chunk of existing.chunks) {
      nextById.set(chunk.chunkId, { ...chunk });
    }
  }
  for (const update of updates) {
    const current = nextById.get(update.chunkId);
    nextById.set(update.chunkId, {
      ...update,
      fileId: update.fileId ?? current?.fileId,
    });
  }
  const merged = Array.from(nextById.values()).sort((left, right) => left.chunkId - right.chunkId);
  return {
    schemaVersion: EVENT_INDEX_SCHEMA_VERSION,
    updatedAt: options.updatedAt,
    lastEventVersion: options.lastEventVersion,
    chunks: merged,
  };
};

export const parseEventIndex = (value: unknown): EventIndex | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schemaVersion !== EVENT_INDEX_SCHEMA_VERSION) {
    return null;
  }
  const updatedAt = asString(value.updatedAt);
  const lastEventVersion = asNumber(value.lastEventVersion);
  const chunks = value.chunks;
  if (!updatedAt || lastEventVersion === null || !Array.isArray(chunks)) {
    return null;
  }
  const parsedChunks: EventIndexChunk[] = [];
  for (const chunk of chunks) {
    if (!isRecord(chunk)) {
      return null;
    }
    const chunkId = asNumber(chunk.chunkId);
    const fromVersion = asNumber(chunk.fromVersion);
    const toVersion = asNumber(chunk.toVersion);
    const eventCount = asNumber(chunk.eventCount);
    const goalIds = readStringArray(chunk.goalIds);
    const positionIds = readStringArray(chunk.positionIds);
    if (
      chunkId === null ||
      fromVersion === null ||
      toVersion === null ||
      eventCount === null ||
      goalIds === null ||
      positionIds === null ||
      chunkId < 1 ||
      fromVersion < 1 ||
      toVersion < fromVersion ||
      eventCount !== toVersion - fromVersion + 1 ||
      toVersion > lastEventVersion ||
      parsedChunks.some((entry) => entry.chunkId === chunkId)
    ) {
      return null;
    }
    const fileId = asString(chunk.fileId) ?? undefined;
    parsedChunks.push({
      chunkId,
      fromVersion,
      toVersion,
      eventCount,
      goalIds,
      positionIds,
      fileId,
    });
  }
  return {
    schemaVersion: EVENT_INDEX_SCHEMA_VERSION,
    updatedAt,
    lastEventVersion,
    chunks: parsedChunks,
  };
};

// Event chunks are immutable between explicit workspace replacements.
export const refreshEventIndex = async (source: {
  listChunkIds: () => Promise<number[]>;
  readChunk: (chunkId: number) => Promise<string>;
  readIndex: () => Promise<EventIndex | null>;
  writeIndex: (index: EventIndex) => Promise<void>;
}): Promise<void> => {
  try {
    const chunkIds = [...new Set(await source.listChunkIds())].sort((a, b) => a - b);
    const existing = await source.readIndex().catch(() => null);
    const existingById = new Map(existing?.chunks.map((chunk) => [chunk.chunkId, chunk]));
    const entries: EventIndexChunk[] = [];
    for (const chunkId of chunkIds) {
      const cached = existingById.get(chunkId);
      if (cached) {
        entries.push(cached);
        continue;
      }
      const chunk = parseEventChunk(await source.readChunk(chunkId));
      if (chunk.chunkId !== chunkId) {
        throw new Error("Event chunk ID does not match its file.");
      }
      entries.push(...buildEventIndexEntries([chunk]));
    }
    const index = mergeEventIndex(null, entries, {
      updatedAt: new Date().toISOString(),
      lastEventVersion: entries.reduce((max, chunk) => Math.max(max, chunk.toVersion), 0),
    });
    if (!parseEventIndex(index)) {
      throw new Error("Event index is invalid.");
    }
    await source.writeIndex(index);
  } catch {
    // Derived data must not fail a save. Readers validate coverage and fall back.
  }
};
