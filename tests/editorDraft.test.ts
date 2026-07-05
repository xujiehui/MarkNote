import assert from 'node:assert/strict';
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
