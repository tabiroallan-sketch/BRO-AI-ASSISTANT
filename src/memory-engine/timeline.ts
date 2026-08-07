import { memoryLastSeen } from './decay.js';
import type { MemoryRecord } from './types.js';

export type MemoryTimelineItem = {
  record: MemoryRecord;
  eventAt: Date;
  activity: 'accessed' | 'updated';
};

export type MemoryTimelineGroup = {
  label: string;
  items: MemoryTimelineItem[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The date that best represents when a memory last mattered. */
export function memoryEventDate(record: MemoryRecord): Date {
  return memoryLastSeen(record.meta, record.updatedAt);
}

function startOfDay(date: Date): number {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Groups memories into a descending timeline of when they were last active.
 * Buckets: Today, Yesterday, Last 7 days, Last 30 days, then by month and by
 * year for older entries. Pure and deterministic.
 */
export function buildMemoryTimeline(records: MemoryRecord[]): MemoryTimelineGroup[] {
  if (records.length === 0) {
    return [];
  }
  const now = new Date();
  const todayStart = startOfDay(now);
  const items = records
    .map((record): MemoryTimelineItem => {
      const eventAt = memoryEventDate(record);
      const wasAccessed =
        record.meta.lastAccessedAt !== undefined &&
        memoryLastSeen(record.meta, record.updatedAt).getTime() !== record.updatedAt.getTime();
      return { record, eventAt, activity: wasAccessed ? 'accessed' : 'updated' };
    })
    .sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());

  const groups: MemoryTimelineGroup[] = [];
  const buckets = new Map<string, MemoryTimelineItem[]>();
  const monthBuckets = new Map<string, MemoryTimelineItem[]>();
  const yearBuckets = new Map<string, MemoryTimelineItem[]>();

  for (const item of items) {
    const days = Math.floor((now.getTime() - item.eventAt.getTime()) / DAY_MS);
    if (item.eventAt.getTime() >= todayStart) {
      push(buckets, 'Today', item);
    } else if (days < 1) {
      push(buckets, 'Yesterday', item);
    } else if (days < 7) {
      push(buckets, 'Last 7 days', item);
    } else if (days < 30) {
      push(buckets, 'Last 30 days', item);
    } else if (new Date(now).getUTCFullYear() - item.eventAt.getUTCFullYear() >= 1) {
      push(yearBuckets, String(item.eventAt.getUTCFullYear()), item);
    } else {
      push(monthBuckets, monthLabel(item.eventAt), item);
    }
  }

  for (const label of ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days']) {
    const bucket = buckets.get(label);
    if (bucket && bucket.length > 0) {
      groups.push({ label, items: bucket });
    }
  }
  const monthLabels = [...monthBuckets.keys()].sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  );
  for (const label of monthLabels) {
    const bucket = monthBuckets.get(label);
    if (bucket && bucket.length > 0) {
      groups.push({ label, items: bucket });
    }
  }
  const yearLabels = [...yearBuckets.keys()].sort((a, b) => Number(b) - Number(a));
  for (const label of yearLabels) {
    const bucket = yearBuckets.get(label);
    if (bucket && bucket.length > 0) {
      groups.push({ label, items: bucket });
    }
  }

  return groups;
}

function push(
  map: Map<string, MemoryTimelineItem[]>,
  label: string,
  item: MemoryTimelineItem,
): void {
  const existing = map.get(label);
  if (existing) {
    existing.push(item);
  } else {
    map.set(label, [item]);
  }
}
