export type PendingEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type StoredEvent = PendingEvent & {
  version: number;
};

export type EventChunk = {
  chunkId: number;
  fromVersion: number;
  toVersion: number;
  createdAt: string;
  events: StoredEvent[];
};

export const assignEventVersions = (events: PendingEvent[], baseVersion: number): StoredEvent[] =>
  events.map((event, index) => ({
    ...event,
    version: baseVersion + index + 1,
  }));

export const buildEventChunks = (
  events: StoredEvent[],
  chunkIdStart: number,
  maxEventsPerChunk: number,
  createdAt: string,
): EventChunk[] => {
  if (events.length === 0) {
    return [];
  }
  const chunks: EventChunk[] = [];
  for (let index = 0; index < events.length; index += maxEventsPerChunk) {
    const slice = events.slice(index, index + maxEventsPerChunk);
    const chunkId = chunkIdStart + Math.floor(index / maxEventsPerChunk);
    chunks.push({
      chunkId,
      fromVersion: slice[0].version,
      toVersion: slice[slice.length - 1].version,
      createdAt,
      events: slice,
    });
  }
  return chunks;
};

export const serializeEventChunk = (chunk: EventChunk): string => {
  const header = {
    chunkId: chunk.chunkId,
    fromVersion: chunk.fromVersion,
    toVersion: chunk.toVersion,
    createdAt: chunk.createdAt,
    eventCount: chunk.events.length,
  };
  const lines = [JSON.stringify(header), ...chunk.events.map((event) => JSON.stringify(event))];
  return `${lines.join("\n")}\n`;
};

export const parseEventChunk = (content: string): EventChunk => {
  const lines = content
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Event chunk is empty.");
  }
  const header = JSON.parse(lines[0]) as EventChunk;
  const events = lines.slice(1).map((line) => JSON.parse(line) as EventChunk["events"][number]);
  return {
    chunkId: header.chunkId,
    fromVersion: header.fromVersion,
    toVersion: header.toVersion,
    createdAt: header.createdAt,
    events,
  };
};
