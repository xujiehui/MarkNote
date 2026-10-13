import { useEffect, useRef, useState } from 'react';
import { createSearchController, normalizeSearchQuery, type IndexedSearchState, type SearchController, type SearchRecord } from '../lib/searchIndex';

export function useIndexedSearch(records: readonly SearchRecord[], query: string): { matches: Set<string> | null; pending: boolean } {
  const normalized = normalizeSearchQuery(query);
  const controller = useRef<SearchController | null>(null);
  const [snapshot, setSnapshot] = useState<IndexedSearchState | null>(null);

  useEffect(() => {
    const current = createSearchController(setSnapshot);
    controller.current = current;
    return () => { current.dispose(); if (controller.current === current) controller.current = null; };
  }, []);

  useEffect(() => { controller.current?.update(records, normalized); }, [records, normalized]);

  // Hide stale results immediately during render; an effect has not yet sent
  // the new query/generation when React first renders changed props.
  const current = snapshot?.records === records && snapshot.query === normalized;
  return {
    matches: normalized && current ? snapshot.matches : null,
    pending: Boolean(normalized && (!current || snapshot.pending)),
  };
}
