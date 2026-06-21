import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { createFolder, createNote, db, ensureDefaultFolders } from '../src/lib/db';
import { createSyncEngine } from '../src/sync/engine';
import type { PushPayload, RemoteSnapshot, RemoteSyncAdapter, SignInInput, SignUpInput } from '../src/sync/types';
import type { SyncDevice } from '../src/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1/',
});

Object.assign(globalThis, {
  localStorage: dom.window.localStorage,
  navigator: dom.window.navigator,
  DOMParser: dom.window.DOMParser,
  HTMLElement: dom.window.HTMLElement,
});

class MemoryAdapter implements RemoteSyncAdapter {
  readonly id = 'custom' as const;
  readonly name = 'Memory';
  readonly configured = true;
  pushed: PushPayload[] = [];
  snapshot: RemoteSnapshot = {
    folders: [],
    notes: [],
    attachments: [],
    serverTime: 0,
  };

  async getSession() {
    return { user: { id: 'user-1', email: 'sync@example.com' } };
  }

  async signIn(_input: SignInInput) {
    void _input;
    return this.getSession();
  }

  async signUp(_input: SignUpInput) {
    void _input;
    return this.getSession();
  }

  async signOut() {
    return undefined;
  }

  async registerDevice(_device: SyncDevice) {
    void _device;
    return undefined;
  }

  async pull(_lastPulledAt: number) {
    void _lastPulledAt;
    return this.snapshot;
  }

  async push(payload: PushPayload) {
    this.pushed.push(payload);
    return { syncedAt: 1000 };
  }
}

async function main() {
  await db.delete();
  await db.open();
  await ensureDefaultFolders();

  const folder = await createFolder('Sync folder');
  const note = await createNote({
    title: 'Local note',
    content: '<p>local</p>',
    folderId: folder.id,
  });

  const adapter = new MemoryAdapter();
  const engine = createSyncEngine(adapter);
  const first = await engine.syncNow();
  assert.equal(first.ok, true);
  assert.equal(first.pushed, 5);
  assert.equal(adapter.pushed[0].folders.length, 4);
  assert.equal(adapter.pushed[0].notes.length, 1);
  assert.equal(await db.syncQueue.count(), 0);
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'synced');

  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: note.id,
        title: 'Remote wins',
        content: '<p>remote</p>',
        rawContent: 'remote',
        folderId: folder.id,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt + 10,
        tags: [],
        pinned: false,
        deletedAt: null,
        syncStatus: 'synced',
      },
    ],
    attachments: [],
    serverTime: 3000,
  };
  const second = await engine.syncNow();
  assert.equal(second.ok, true);
  assert.equal((await db.notes.get(note.id))?.title, 'Remote wins');

  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: note.id,
        title: 'Remote deleted',
        content: '<p>deleted</p>',
        rawContent: 'deleted',
        folderId: folder.id,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt + 20,
        tags: [],
        pinned: false,
        deletedAt: note.updatedAt + 20,
        syncStatus: 'synced',
      },
    ],
    attachments: [],
    serverTime: 4000,
  };
  const third = await engine.syncNow();
  assert.equal(third.ok, true);
  assert.equal(await db.notes.get(note.id), undefined);

  console.log('sync tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    db.close();
  });
