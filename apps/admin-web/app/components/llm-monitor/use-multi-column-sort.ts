import { useCallback, useState, type KeyboardEvent } from "react";
import type { CompareFn, SortOrder } from "antd/es/table/interface";

import {
  MULTI_SORT_DIRECTIONS,
  multiColumnSorter,
  multiSortPriority,
  toggleMultiSort,
  type ActiveMultiSort,
  type MultiColumnSorter,
} from "./table-sorting";

export interface MultiColumnSortController {
  sortDirections: SortOrder[];
  column<T>(key: string, compare: CompareFn<T>): {
    sorter: MultiColumnSorter<T>;
    sortOrder: SortOrder;
    onHeaderCell: () => {
      onClick: () => void;
      onKeyDown: (event: KeyboardEvent) => void;
    };
  };
}

export function useMultiColumnSort(): MultiColumnSortController {
  const [activeSorters, setActiveSorters] = useState<ActiveMultiSort[]>([]);
  const toggle = useCallback((key: string) => {
    setActiveSorters((current) => toggleMultiSort(current, key));
  }, []);

  return {
    sortDirections: MULTI_SORT_DIRECTIONS,
    column: <T,>(key: string, compare: CompareFn<T>) => ({
      sorter: multiColumnSorter(compare, multiSortPriority(activeSorters, key)),
      sortOrder: activeSorters.find((item) => item.key === key)?.order ?? null,
      onHeaderCell: () => ({
        onClick: () => toggle(key),
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.keyCode === 13) toggle(key);
        },
      }),
    }),
  };
}
