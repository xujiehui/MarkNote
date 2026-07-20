interface NoteSelectionItem {
  id: string;
}

export interface ActiveNoteSelectionOptions {
  activeNoteId: string;
  pendingNoteId: string;
  notes: NoteSelectionItem[];
  visibleNotes: NoteSelectionItem[];
}

export function resolveActiveNoteSelection({
  activeNoteId,
  pendingNoteId,
  notes,
  visibleNotes,
}: ActiveNoteSelectionOptions): string {
  if (activeNoteId && pendingNoteId === activeNoteId && !notes.some((note) => note.id === activeNoteId)) {
    return activeNoteId;
  }
  if (activeNoteId && visibleNotes.some((note) => note.id === activeNoteId)) {
    return activeNoteId;
  }
  return visibleNotes[0]?.id || '';
}
