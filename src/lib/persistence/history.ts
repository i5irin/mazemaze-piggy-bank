import { formatCurrency } from "@/lib/numberFormat";
import { parseEventChunk, type StoredEvent } from "./eventChunk";
import type { EventIndex } from "./eventIndex";

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
  progress?: { currentAmount: number; targetAmount: number };
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
  readIndex?: () => Promise<EventIndex | null>;
  getSnapshotVersion?: () => number | null;
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

const asOrigin = (value: unknown): HistoryOrigin | null =>
  value === "user" || value === "system" ? value : null;

const asProgress = (value: unknown): { currentAmount: number; targetAmount: number } | null => {
  if (!isRecord(value)) {
    return null;
  }
  const currentAmount = asFiniteNumber(value.currentAmount ?? value.current ?? value.progress);
  const targetAmount = asFiniteNumber(value.targetAmount ?? value.target);
  if (currentAmount === null || targetAmount === null) {
    return null;
  }
  return { currentAmount, targetAmount };
};

const pickPayloadString = (payload: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = asString(payload[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const formatName = (value: string | null): string | null => (value ? value : null);

const formatPositionContext = (
  positionLabel: string | null,
  accountName: string | null,
): string | null => {
  if (positionLabel && accountName) {
    return `${positionLabel} in ${accountName}`;
  }
  return positionLabel ?? null;
};

const formatAllocationContext = (
  goalName: string | null,
  positionContext: string | null,
): string | null => {
  if (goalName && positionContext) {
    return `${goalName} from ${positionContext}`;
  }
  return goalName ?? positionContext ?? null;
};

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

const filterChunkIdsByIndex = (index: EventIndex, filter?: HistoryFilter): number[] => {
  if (!filter?.goalId && !filter?.positionId) {
    return [...index.chunks].map((chunk) => chunk.chunkId).sort((left, right) => right - left);
  }
  const result: number[] = [];
  for (const chunk of index.chunks) {
    if (filter.goalId && !chunk.goalIds.includes(filter.goalId)) {
      continue;
    }
    if (filter.positionId && !chunk.positionIds.includes(filter.positionId)) {
      continue;
    }
    result.push(chunk.chunkId);
  }
  return result.sort((left, right) => right - left);
};

const toEventLabel = (eventType: string): string =>
  EVENT_LABELS[eventType] ?? eventType.replaceAll("_", " ");

const buildSummary = (event: StoredEvent): { summary: string; amountDelta?: number } => {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.type === "allocation_created") {
    const amountAfter = asFiniteNumber(payload.amountAfter ?? payload.amount);
    const amountDelta = asFiniteNumber(payload.amountDelta) ?? amountAfter;
    const goalName = formatName(pickPayloadString(payload, ["goalName", "name"]));
    const positionLabel = formatName(pickPayloadString(payload, ["positionLabel", "label"]));
    const accountName = formatName(pickPayloadString(payload, ["accountName"]));
    const positionContext = formatPositionContext(positionLabel, accountName);
    const allocationContext = formatAllocationContext(goalName, positionContext);
    const origin = asOrigin(payload.origin);
    const trigger = asString(payload.trigger);
    const prefix =
      origin === "system"
        ? trigger === "position_recalc"
          ? "Allocation added automatically after value update"
          : "Allocation added automatically"
        : "Allocation added";
    if (amountAfter !== null && allocationContext) {
      return {
        summary: `${prefix} for ${allocationContext}: ${formatCurrency(amountAfter)}.`,
        amountDelta: amountDelta ?? undefined,
      };
    }
    if (amountAfter !== null) {
      return {
        summary: `${prefix}: ${formatCurrency(amountAfter)}.`,
        amountDelta: amountDelta ?? undefined,
      };
    }
    return { summary: `${prefix}.` };
  }
  if (event.type === "allocation_updated") {
    const amountBefore = asFiniteNumber(payload.amountBefore);
    const amountAfter = asFiniteNumber(payload.amountAfter ?? payload.amount);
    const amountDelta =
      asFiniteNumber(payload.amountDelta) ??
      (amountBefore !== null && amountAfter !== null ? amountAfter - amountBefore : null);
    const goalName = formatName(pickPayloadString(payload, ["goalName", "name"]));
    const positionLabel = formatName(pickPayloadString(payload, ["positionLabel", "label"]));
    const accountName = formatName(pickPayloadString(payload, ["accountName"]));
    const positionContext = formatPositionContext(positionLabel, accountName);
    const allocationContext = formatAllocationContext(goalName, positionContext);
    const origin = asOrigin(payload.origin);
    const trigger = asString(payload.trigger);
    const prefix =
      origin === "system"
        ? trigger === "position_recalc"
          ? "Allocation adjusted automatically after value update"
          : "Allocation adjusted automatically"
        : "Allocation updated";
    const rangeText =
      amountBefore !== null && amountAfter !== null
        ? `${formatCurrency(amountBefore)} -> ${formatCurrency(amountAfter)}`
        : amountAfter !== null
          ? formatCurrency(amountAfter)
          : null;
    if (rangeText && allocationContext) {
      return {
        summary: `${prefix} for ${allocationContext}: ${rangeText}.`,
        amountDelta: amountDelta ?? undefined,
      };
    }
    if (rangeText) {
      return {
        summary: `${prefix}: ${rangeText}.`,
        amountDelta: amountDelta ?? undefined,
      };
    }
    return { summary: `${prefix}.` };
  }
  if (event.type === "allocation_deleted") {
    const amountBefore = asFiniteNumber(payload.amountBefore ?? payload.amount);
    const amountDelta =
      asFiniteNumber(payload.amountDelta) ?? (amountBefore !== null ? -amountBefore : null);
    const goalName = formatName(pickPayloadString(payload, ["goalName", "name"]));
    const positionLabel = formatName(pickPayloadString(payload, ["positionLabel", "label"]));
    const accountName = formatName(pickPayloadString(payload, ["accountName"]));
    const positionContext = formatPositionContext(positionLabel, accountName);
    const allocationContext = formatAllocationContext(goalName, positionContext);
    const origin = asOrigin(payload.origin);
    const trigger = asString(payload.trigger);
    const prefix =
      origin === "system"
        ? trigger === "position_recalc"
          ? "Allocation removed automatically after value update"
          : "Allocation removed automatically"
        : "Allocation removed";
    if (amountBefore !== null && allocationContext) {
      return {
        summary: `${prefix} for ${allocationContext}: ${formatCurrency(amountBefore)}.`,
        amountDelta: amountDelta ?? undefined,
      };
    }
    if (amountBefore !== null) {
      return {
        summary: `${prefix}: ${formatCurrency(amountBefore)}.`,
        amountDelta: amountDelta ?? undefined,
      };
    }
    return { summary: `${prefix}.` };
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
    if (reductions.length === 1 && isRecord(reductions[0])) {
      const entry = reductions[0];
      const amount = asFiniteNumber(entry.amount);
      const goalName = formatName(pickPayloadString(entry, ["goalName", "name"]));
      const positionLabel = formatName(pickPayloadString(entry, ["positionLabel", "label"]));
      const accountName = formatName(pickPayloadString(entry, ["accountName"]));
      const positionContext = formatPositionContext(positionLabel, accountName);
      const allocationContext = formatAllocationContext(goalName, positionContext);
      if (amount !== null && allocationContext) {
        return {
          summary: `Allocation reduced for ${allocationContext}: ${formatCurrency(amount)}.`,
          amountDelta: -amount,
        };
      }
      if (amount !== null) {
        return {
          summary: `Allocation reduced: ${formatCurrency(amount)}.`,
          amountDelta: -amount,
        };
      }
    }
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
    const label = formatName(pickPayloadString(payload, ["label", "positionLabel"])) ?? "Position";
    if (marketValue === null) {
      return {
        summary: `Value updated: ${label}.`,
      };
    }
    return {
      summary: `Value updated: ${label} -> ${formatCurrency(marketValue)}.`,
    };
  }
  if (event.type === "position_created") {
    const label = formatName(pickPayloadString(payload, ["label", "positionLabel"]));
    const accountName = formatName(pickPayloadString(payload, ["accountName", "name"]));
    if (label && accountName) {
      return { summary: `Position added: ${label} -> ${accountName}.` };
    }
    if (label) {
      return { summary: `Position added: ${label}.` };
    }
    return { summary: "Position added." };
  }
  if (event.type === "position_deleted") {
    const label = formatName(pickPayloadString(payload, ["label", "positionLabel"]));
    if (label) {
      return { summary: `Position deleted: ${label}.` };
    }
    return { summary: "Position deleted." };
  }
  if (event.type === "account_created") {
    const name = formatName(pickPayloadString(payload, ["accountName", "name"]));
    if (name) {
      return { summary: `Account created: ${name}.` };
    }
    return { summary: "Account created." };
  }
  if (event.type === "account_updated") {
    const name = formatName(pickPayloadString(payload, ["accountName", "name"]));
    return name ? { summary: `Account updated: ${name}.` } : { summary: "Account updated." };
  }
  if (event.type === "account_deleted") {
    const name = formatName(pickPayloadString(payload, ["accountName", "name"]));
    if (name) {
      return { summary: `Account deleted: ${name}.` };
    }
    return { summary: "Account deleted." };
  }
  if (event.type === "goal_created") {
    const name = formatName(pickPayloadString(payload, ["goalName", "name"]));
    return name ? { summary: `Goal created: ${name}.` } : { summary: "Goal created." };
  }
  if (event.type === "goal_updated") {
    const targetAmount = asFiniteNumber(payload.targetAmount);
    const name = formatName(pickPayloadString(payload, ["goalName", "name"]));
    if (targetAmount === null) {
      return name ? { summary: `Goal ${name} updated.` } : { summary: "Goal updated." };
    }
    if (name) {
      return { summary: `Goal ${name} target updated to ${formatCurrency(targetAmount)}.` };
    }
    return { summary: `Goal target updated to ${formatCurrency(targetAmount)}.` };
  }
  if (event.type === "goal_deleted") {
    const name = formatName(pickPayloadString(payload, ["goalName", "name"]));
    if (name) {
      return { summary: `Goal deleted: ${name}.` };
    }
    return { summary: "Goal deleted." };
  }
  if (event.type === "goal_spent") {
    const totalAmount = asFiniteNumber(payload.totalAmount);
    const name = formatName(pickPayloadString(payload, ["goalName", "name"]));
    if (totalAmount === null) {
      return name
        ? { summary: `Goal ${name} marked as spent.` }
        : { summary: "Goal marked as spent." };
    }
    return {
      summary: name
        ? `Goal ${name} spent: ${formatCurrency(totalAmount)}.`
        : `Goal spent: ${formatCurrency(totalAmount)}.`,
      amountDelta: -totalAmount,
    };
  }
  if (event.type === "goal_spend_undone") {
    const name = formatName(pickPayloadString(payload, ["goalName", "name"]));
    return name
      ? { summary: `Spend action undone for ${name}.` }
      : { summary: "Spend action was undone." };
  }
  if (event.type === "state_repaired") {
    return { summary: "Data integrity was repaired." };
  }
  return { summary: "Activity updated." };
};

const buildHistoryItem = (event: StoredEvent): HistoryItem => {
  const { summary, amountDelta } = buildSummary(event);
  const payload = isRecord(event.payload) ? event.payload : {};
  const originOverride = asOrigin(payload.origin);
  const progress = asProgress(payload.goalProgress ?? payload.progress);
  return {
    id: `${event.id}:${event.version}`,
    timestamp: event.createdAt,
    eventType: toEventLabel(event.type),
    summary,
    origin: originOverride ?? (SYSTEM_EVENT_TYPES.has(event.type) ? "system" : "user"),
    amountDelta,
    progress: progress ?? undefined,
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
    const snapshotVersion = source.getSnapshotVersion?.() ?? null;
    let index: EventIndex | null = null;
    if (source.readIndex) {
      try {
        index = await source.readIndex();
      } catch {
        index = null;
      }
    }
    const listedChunkIds = [...new Set(await source.listChunkIds())];
    const indexedChunkIds = new Set(index?.chunks.map((chunk) => chunk.chunkId));
    const useIndex =
      index &&
      snapshotVersion !== null &&
      index.lastEventVersion === snapshotVersion &&
      indexedChunkIds.size === index.chunks.length &&
      indexedChunkIds.size === listedChunkIds.length &&
      listedChunkIds.every((chunkId) => indexedChunkIds.has(chunkId));
    const chunkIdsDesc =
      useIndex && index
        ? filterChunkIdsByIndex(index, input.filter)
        : listedChunkIds.sort((left, right) => right - left);
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
      let parsed;
      try {
        parsed = parseEventChunk(await source.readChunk(chunkId));
      } catch (error) {
        if (useIndex) {
          // Retry once without the index if files changed during this request.
          return createHistoryLoader({ ...source, readIndex: undefined })(input);
        }
        throw error;
      }
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
