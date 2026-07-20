import assert from 'node:assert/strict';
import { resolveActiveNoteSelection } from '../src/lib/activeNoteSelection';
import { clampContextMenuPosition } from '../src/lib/contextMenuPosition';
import { isDraftSaveSnapshotCurrent, resolveActiveNoteDraftValue, shouldResetActiveNoteDraftMeta } from '../src/lib/editorDraft';

function main() {
  assert.equal(
    resolveActiveNoteDraftValue({
      current: 'typing in progress',
      incoming: 'remote refreshed title',
      noteChanged: false,
      dirty: true,
    }),
    'typing in progress',
  );
  assert.equal(shouldResetActiveNoteDraftMeta(false, true), false);

  assert.equal(
    resolveActiveNoteSelection({
      activeNoteId: 'new-note',
      pendingNoteId: 'new-note',
      notes: [{ id: 'welcome-note' }],
      visibleNotes: [{ id: 'welcome-note' }],
    }),
    'new-note',
  );
  assert.equal(
    resolveActiveNoteSelection({
      activeNoteId: 'outside-filter',
      pendingNoteId: '',
      notes: [{ id: 'outside-filter' }, { id: 'visible-note' }],
      visibleNotes: [{ id: 'visible-note' }],
    }),
    'visible-note',
  );

  assert.deepEqual(
    clampContextMenuPosition({
      x: 1200,
      y: 700,
      menuWidth: 224,
      menuHeight: 732,
      viewportWidth: 1280,
      viewportHeight: 720,
    }),
    { left: 1048, top: 8 },
  );

  assert.equal(
    resolveActiveNoteDraftValue({
      current: 'previous note draft',
      incoming: 'next selected note',
      noteChanged: true,
      dirty: true,
    }),
    'next selected note',
  );
  assert.equal(shouldResetActiveNoteDraftMeta(true, true), true);

  assert.equal(
    resolveActiveNoteDraftValue({
      current: 'clean local value',
      incoming: 'remote clean update',
      noteChanged: false,
      dirty: false,
    }),
    'remote clean update',
  );
  assert.equal(shouldResetActiveNoteDraftMeta(false, false), true);

  const savedSnapshot = {
    noteId: 'note-1',
    title: 'Title before save',
    content: '<p>Content before save</p>',
  };
  assert.equal(isDraftSaveSnapshotCurrent(savedSnapshot, savedSnapshot), true);
  assert.equal(
    isDraftSaveSnapshotCurrent(savedSnapshot, {
      ...savedSnapshot,
      content: '<p>Typed while save was still in flight</p>',
    }),
    false,
  );
  assert.equal(
    isDraftSaveSnapshotCurrent(savedSnapshot, {
      ...savedSnapshot,
      noteId: 'note-2',
    }),
    false,
  );

  console.log('editor draft tests passed');
}

main();
