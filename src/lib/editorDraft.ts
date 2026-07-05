export interface DraftValueOptions<T> {
  current: T;
  incoming: T;
  noteChanged: boolean;
  dirty: boolean;
}

export function resolveActiveNoteDraftValue<T>({ current, incoming, noteChanged, dirty }: DraftValueOptions<T>): T {
  return noteChanged || !dirty ? incoming : current;
}

export function shouldResetActiveNoteDraftMeta(noteChanged: boolean, dirty: boolean): boolean {
  return noteChanged || !dirty;
}

export interface DraftSaveSnapshot {
  noteId: string;
  title: string;
  content: string;
}

export function isDraftSaveSnapshotCurrent(
  snapshot: DraftSaveSnapshot,
  current: DraftSaveSnapshot,
): boolean {
  return snapshot.noteId === current.noteId && snapshot.title === current.title && snapshot.content === current.content;
}
