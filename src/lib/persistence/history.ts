import { formatCurrency } from "@/lib/numberFormat";
import { parseEventChunk, type StoredEvent } from "./eventChunk";

export type HistoryFilter = {
  goalId?: string;
  positionId?: string;
};

export type HistoryOrigin = "user" | "system";

export type HistoryItem = {
  id: string;
  timestamp: string;
  eventType: string;
  summary: string;
  origin: HistoryOrigin;
  amountDelta?: number;
};

export type HistoryPage = {
  items: HistoryItem[];
  nextCursor: string | null;
};

type HistoryCursor = {
  chunkId: number;
  eventIndex: number;
};

type HistorySource = {
  listChunkIds: () => Promise<number[]>;
  readChunk: (chunkId: number) => Promise<string>;
};

type HistoryLoadInput = {
  limit: number;
  cursor?: string | null;
  filter?: HistoryFilter;
};

const EVENT_LABELS: Record<string, string> = {
  account_created: "Account created",
  account_updated: "Account updated",
  account_deleted: "Account deleted",
  position_created: "Position created",
  position_updated: "Position updated",
  position_deleted: "Position deleted",
  goal_created: "Goal created",
  goal_updated: "Goal updated",
  goal_deleted: "Goal deleted",
  allocation_created: "Allocation created",
  allocation_updated: "Allocation updated",
  allocation_deleted: "Allocation deleted",
  allocations_reduced: "Allocations reduced",
  state_repaired: "Data repaired",
  goal_spent: "Goal spent",
  goal_spend_undone: "Goal spend undone",
};
const SYSTEM_EVENT_TYPES = new Set<string>(["allocations_reduced", "state_repaired"]);
const MAX_SCANNED_CHUNKS_PER_PAGE = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const parseCursor = (value: string | null | undefined): HistoryCursor | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const chunkId = asFiniteNumber(parsed.chunkId);
    const eventIndex = asFiniteNumber(parsed.eventIndex);
    if (chunkId === null || eventIndex === null) {
      return null;
    }
    return {
      chunkId,
      eventIndex,
    };
  } catch {
    return null;
  }
};

const encodeCursor = (cursor: HistoryCursor): string => JSON.stringify(cursor);

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

const uniqueIds = (ids: string[]): string[] => Array.from(new Set(ids));

const collectGoalIds = (payload: Record<string, unknown>): string[] => {
  const ids: string[] = [];
  appendDirectId(ids, payload, "goalId");
  appendIdArray(ids, payload, "goalIds");
  appendIdArray(ids, payload, "affectedGoalIds");
  appendNestedIds(ids, payload, "allocations", "goalId");
  return uniqueIds(ids);
};

const collectPositionIds = (payload: Record<string, unknown>): string[] => {
  const ids: string[] = [];
  appendDirectId(ids, payload, "positionId");
  appendIdArray(ids, payload, "positionIds");
  appendIdArray(ids, payload, "affectedPositionIds");
  appendNestedIds(ids, payload, "allocations", "positionId");
  appendNestedIds(ids, payload, "payments", "positionId");
  appendNestedIds(ids, payload, "positions", "id");
  return uniqueIds(ids);
};

const eventMatchesFilter = (event: StoredEvent, filter?: HistoryFilter): boolean => {
  if (!filter?.goalId && !filter?.positionId) {
    return true;
  }
  if (!isRecord(event.payload)) {
    return false;
  }
  const payload = event.payload;
  const goalIds = collectGoalIds(payload);
  const positionIds = collectPositionIds(payload);
  if (filter.goalId && !goalIds.includes(filter.goalId)) {
    return false;
  }
  if (filter.positionId && !positionIds.includes(filter.positionId)) {
    return false;
  }
  return true;
};

const toEventLabel = (eventType: string): string =>
  EVENT_LABELS[eventType] ?? eventType.replaceAll("_", " ");

const buildSummary = (event: StoredEvent): { summary: string; amountDelta?: number } => {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.type === "allocation_created") {
    const amount = asFiniteNumber(payload.amount);
    return amount === null
      ? { summary: "Allocation added." }
      : { summary: `Allocation added: ${formatCurrency(amount)}.`, amountDelta: amount };
  }
  if (event.type === "allocation_updated") {
    const amount = asFiniteNumber(payload.amount);
    return amount === null
      ? { summary: "Allocation changed." }
      : { summary: `Allocation set to ${formatCurrency(amount)}.` };
  }
  if (event.type === "allocation_deleted") {
    return { summary: "Allocation removed." };
  }
  if (event.type === "allocations_reduced") {
    const reductions = Array.isArray(payload.reductions) ? payload.reductions : [];
    const total = reductions.reduce((sum, entry) => {
      if (!isRecord(entry)) {
        return sum;
      }
      const amount = asFiniteNumber(entry.amount);
      return sum + (amount ?? 0);
    }, 0);
    if (total <= 0) {
      return { summary: "Allocations reduced." };
    }
    return {
      summary: `Allocations reduced by ${formatCurrency(total)}.`,
      amountDelta: -total,
    };
  }
  if (event.type === "position_updated") {
    const marketValue = asFiniteNumber(payload.marketValue);
    const recalculated = payload.recalculated === true;
    if (marketValue === null) {
      return {
        summary: recalculated ? "Position updated and allocations adjusted." : "Position updated.",
      };
    }
    return {
      summary: recalculated
        ? `Position value updated to ${formatCurrency(marketValue)} and allocations adjusted.`
        : `Position value updated to ${formatCurrency(marketValue)}.`,
    };
  }
  if (event.type === "goal_updated") {
    const targetAmount = asFiniteNumber(payload.targetAmount);
    if (targetAmount === null) {
      return { summary: "Goal updated." };
    }
    return { summary: `Goal target updated to ${formatCurrency(targetAmount)}.` };
  }
  if (event.type === "goal_spent") {
    const totalAmount = asFiniteNumber(payload.totalAmount);
    if (totalAmount === null) {
      return { summary: "Goal marked as spent." };
    }
    return {
      summary: `Goal spent: ${formatCurrency(totalAmount)}.`,
      amountDelta: -totalAmount,
    };
  }
  if (event.type === "goal_spend_undone") {
    return { summary: "Spend action was undone." };
  }
  if (event.type === "state_repaired") {
    return { summary: "Data integrity was repaired." };
  }
  return { summary: `${toEventLabel(event.type)}.` };
};

const buildHistoryItem = (event: StoredEvent): HistoryItem => {
  const { summary, amountDelta } = buildSummary(event);
  return {
    id: `${event.id}:${event.version}`,
    timestamp: event.createdAt,
    eventType: toEventLabel(event.type),
    summary,
    origin: SYSTEM_EVENT_TYPES.has(event.type) ? "system" : "user",
    amountDelta,
  };
};

const resolveStartChunkIndex = (chunkIdsDesc: number[], cursor: HistoryCursor | null): number => {
  if (!cursor) {
    return 0;
  }
  const exact = chunkIdsDesc.findIndex((chunkId) => chunkId === cursor.chunkId);
  if (exact >= 0) {
    return exact;
  }
  return chunkIdsDesc.findIndex((chunkId) => chunkId < cursor.chunkId);
};

export const createHistoryLoader =
  (source: HistorySource) =>
  async (input: HistoryLoadInput): Promise<HistoryPage> => {
    const requestedLimit = Math.floor(input.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
    const cursor = parseCursor(input.cursor);
    const chunkIdsDesc = [...(await source.listChunkIds())].sort((left, right) => right - left);
    if (chunkIdsDesc.length === 0) {
      return { items: [], nextCursor: null };
    }

    const startChunkIndex = resolveStartChunkIndex(chunkIdsDesc, cursor);
    if (startChunkIndex < 0) {
      return { items: [], nextCursor: null };
    }

    let chunkIndex = startChunkIndex;
    let eventIndex = cursor?.eventIndex ?? -1;
    const items: HistoryItem[] = [];
    let scannedChunks = 0;

    while (
      chunkIndex < chunkIdsDesc.length &&
      items.length < limit &&
      scannedChunks < MAX_SCANNED_CHUNKS_PER_PAGE
    ) {
      const chunkId = chunkIdsDesc[chunkIndex];
      const content = await source.readChunk(chunkId);
      const parsed = parseEventChunk(content);
      scannedChunks += 1;
      const startEventIndex =
        eventIndex >= 0 ? Math.min(eventIndex, parsed.events.length - 1) : parsed.events.length - 1;
      let nextIndex = startEventIndex;

      while (nextIndex >= 0 && items.length < limit) {
        const event = parsed.events[nextIndex];
        nextIndex -= 1;
        if (!eventMatchesFilter(event, input.filter)) {
          continue;
        }
        items.push(buildHistoryItem(event));
      }

      if (items.length >= limit) {
        if (nextIndex >= 0) {
          return {
            items,
            nextCursor: encodeCursor({
              chunkId,
              eventIndex: nextIndex,
            }),
          };
        }
        const nextChunkId = chunkIdsDesc[chunkIndex + 1];
        return {
          items,
          nextCursor:
            nextChunkId === undefined
              ? null
              : encodeCursor({
                  chunkId: nextChunkId,
                  eventIndex: -1,
                }),
        };
      }

      chunkIndex += 1;
      eventIndex = -1;
    }

    if (chunkIndex < chunkIdsDesc.length) {
      return {
        items,
        nextCursor: encodeCursor({
          chunkId: chunkIdsDesc[chunkIndex],
          eventIndex: -1,
        }),
      };
    }
    return { items, nextCursor: null };
  };
