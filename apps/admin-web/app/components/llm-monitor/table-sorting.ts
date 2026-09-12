import type { CompareFn, SortOrder } from "antd/es/table/interface";

export const MULTI_SORT_DIRECTIONS: SortOrder[] = ["ascend", "descend", null];

export interface MultiColumnSorter<T> {
  compare: CompareFn<T>;
  multiple: number;
}

export type MultiSortOrder = Exclude<SortOrder, null>;

export interface ActiveMultiSort {
  key: string;
  order: MultiSortOrder;
}

export function multiColumnSorter<T>(compare: CompareFn<T>, multiple = 1): MultiColumnSorter<T> {
  return { compare, multiple };
}

export function toggleMultiSort(current: ActiveMultiSort[], key: string): ActiveMultiSort[] {
  const index = current.findIndex((item) => item.key === key);
  if (index === -1) return [...current, { key, order: "ascend" }];

  const item = current[index];
  if (item.order === "ascend") {
    return current.map((entry, entryIndex) => entryIndex === index ? { ...entry, order: "descend" } : entry);
  }
  return current.filter((_, entryIndex) => entryIndex !== index);
}

export function multiSortPriority(current: ActiveMultiSort[], key: string): number {
  const index = current.findIndex((item) => item.key === key);
  return index === -1 ? 0 : current.length - index;
}

export function compareNumbers(left?: number, right?: number): number {
  return (left ?? -1) - (right ?? -1);
}

export function compareText(left?: string, right?: string): number {
  return (left ?? "").localeCompare(right ?? "", "zh-CN", { numeric: true, sensitivity: "base" });
}

export function compareTimestamps(left?: string, right?: string): number {
  return compareNumbers(toTimestamp(left), toTimestamp(right));
}

function toTimestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
