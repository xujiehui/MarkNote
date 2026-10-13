import assert from 'node:assert/strict';
import { NoteSaveCoordinator, type NoteDraftSnapshot, type NoteSaveStore } from '../src/services/noteSave';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const drafts = new Map<string, NoteDraftSnapshot>();
  const notes = new Map<string, string>();
  let fail = false;
  let pause: ReturnType<typeof deferred> | undefined;
  const events: string[] = [];
  const store: NoteSaveStore = {
    persistDraft: async (snapshot) => { if (fail) throw new Error('QuotaExceededError'); drafts.set(snapshot.noteId, snapshot); },
    readDraft: async (id) => drafts.get(id),
    commitDraft: async (snapshot) => {
      if (pause) { const gate = pause; pause = undefined; await gate.promise; }
      if (fail) throw new Error('QuotaExceededError');
      notes.set(snapshot.noteId, snapshot.content);
      if (drafts.get(snapshot.noteId)?.revision === snapshot.revision) drafts.delete(snapshot.noteId);
    },
  };
  const coordinator = new NoteSaveCoordinator(store, (event) => events.push(event.state));
  coordinator.stage('A', 'Title', '<p>typed immediately before switching</p>');
  await coordinator.flush('A');
  assert.equal(notes.get('A'), '<p>typed immediately before switching</p>');
  assert.equal(coordinator.hasPending(), false);

  const gate = deferred(); pause = gate;
  coordinator.stage('A', 'Title', '<p>old request</p>');
  const save = coordinator.flush('A');
  await new Promise((resolve) => setTimeout(resolve, 0));
  coordinator.stage('A', 'Title', '<p>new input during write</p>');
  gate.resolve(); await save;
  assert.equal(notes.get('A'), '<p>new input during write</p>');
  assert.equal(coordinator.hasPending('A'), false);

  fail = true;
  coordinator.stage('B', 'Recover me', '<p>unsaved but retained</p>');
  await assert.rejects(coordinator.flush('B'), /QuotaExceeded/);
  assert.equal(coordinator.hasPending('B'), true);
  assert.ok(events.includes('error'));
  fail = false; await coordinator.flushAll();
  assert.equal(notes.get('B'), '<p>unsaved but retained</p>');

  coordinator.stage('C', 'After crash', '<p>persistent draft</p>');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const restarted = new NoteSaveCoordinator(store);
  assert.equal((await restarted.recover('C'))?.content, '<p>persistent draft</p>');
  await restarted.flushAll();
  assert.equal(notes.get('C'), '<p>persistent draft</p>');
  console.log('note save tests passed');
}

void main();
