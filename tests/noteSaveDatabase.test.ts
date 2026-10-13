import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { installDomGlobals } from './domGlobals';
import { createNote, db, ensureDefaultFolders } from '../src/lib/db';
import { createDatabaseSaveStore, NoteSaveCoordinator } from '../src/services/noteSave';

const dom = new JSDOM('', { url: 'http://127.0.0.1/' });
installDomGlobals({ window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, localStorage: dom.window.localStorage, navigator: dom.window.navigator });

async function main() {
  await db.delete(); await db.open(); await ensureDefaultFolders();
  const note = await createNote({ title: 'Shared note', content: '<p>initial</p>' });
  const savedIds: string[] = [];
  const first = new NoteSaveCoordinator(createDatabaseSaveStore(db));
  const second = new NoteSaveCoordinator(createDatabaseSaveStore(db), (event) => { if (event.state === 'saved' && event.savedNoteId) savedIds.push(event.savedNoteId); });
  first.stage(note.id, 'Tab one', '<p>first tab text</p>', note.version);
  second.stage(note.id, 'Tab two', '<p>second tab text</p>', note.version);
  await first.flushAll(); await second.flushAll();
  assert.equal((await db.notes.get(note.id))?.content, '<p>first tab text</p>');
  assert.notEqual(savedIds[0], note.id);
  assert.equal((await db.notes.get(savedIds[0]))?.content, '<p>second tab text</p>');
  assert.match((await db.notes.get(savedIds[0]))!.title, /冲突副本/);
  assert.equal(await db.editorDrafts.count(), 0);
  assert.equal(await db.syncQueue.where('entity').equals('note').count(), 2);

  const current = (await db.notes.get(note.id))!;
  first.stage(note.id, 'New input', '<p>latest version is a legitimate baseline</p>', current.version);
  await first.flushAll();
  assert.equal((await db.notes.get(note.id))?.content, '<p>latest version is a legitimate baseline</p>');
  assert.equal(await db.notes.count(), 2);
  const preEdit = await db.noteHistory.where('noteId').equals(note.id).toArray();
  assert.ok(preEdit.some((entry) => entry.content === '<p>initial</p>'));
  await db.delete();
  console.log('Note save database tests passed (two-tab CAS, conflict retention, drafts, atomic queue/history)');
}
void main();
