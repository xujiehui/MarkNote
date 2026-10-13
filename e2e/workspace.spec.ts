import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('marknote-language', 'en'));
  await page.goto('/?app=1');
  await expect(page.locator('[contenteditable=true]')).toBeVisible();
});

test('typing immediately before new-note navigation persists both title and body', async ({ page }) => {
  const title = page.locator('input[placeholder="Untitled note"]');
  await title.fill('A saved without waiting');
  const editor = page.locator('[contenteditable=true]');
  await editor.fill('Content typed before a fast switch');
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await expect(title).not.toHaveValue('A saved without waiting');
  await page.getByRole('button', { name: 'A saved without waiting', exact: false }).first().click();
  await expect(title).toHaveValue('A saved without waiting');
  await expect(editor).toContainText('Content typed before a fast switch');
  await page.reload();
  await page.getByRole('button', { name: 'A saved without waiting', exact: false }).first().click();
  await expect(editor).toContainText('Content typed before a fast switch');
});

test('editor creates real tables and unavailable product capabilities stay hidden', async ({ page }) => {
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.locator('input[placeholder="Untitled note"]').fill('Persisted real table');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.locator('[contenteditable=true] table')).toBeVisible();
  await page.locator('[contenteditable=true] table tr').first().locator('th, td').first().click();
  await page.keyboard.type('Saved table cell');
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByRole('button', { name: 'Persisted real table', exact: true }).click();
  await expect(page.locator('[contenteditable=true] table')).toContainText('Saved table cell');
  await page.reload();
  await page.getByRole('button', { name: 'Persisted real table', exact: true }).click();
  await expect(page.locator('[contenteditable=true] table')).toContainText('Saved table cell');
  await expect(page.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Math', exact: true })).toHaveCount(0);
});

test('production PWA reloads and reopens offline without the HTTP cache', async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.clearBrowserCache');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[contenteditable=true]')).toBeVisible();
  const reopened = await context.newPage();
  const reopenedSession = await context.newCDPSession(reopened);
  await reopenedSession.send('Network.enable');
  await reopenedSession.send('Network.setCacheDisabled', { cacheDisabled: true });
  await reopened.goto('/?app=1');
  await expect(reopened.locator('[contenteditable=true]')).toBeVisible();
});

test('phone layout keeps the editor usable and supports returning to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  const editor = page.locator('[contenteditable=true]');
  await expect(editor).toBeVisible();
  await page.locator('input[placeholder="Untitled note"]').fill('Phone note');
  const bounds = await editor.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.locator('.mobile-navigation').getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Phone note', exact: false }).first()).toBeVisible();
});


test('a durable unfinished draft survives reloading as a visible recovery copy', async ({ page }) => {
  const title = page.locator('input[placeholder="Untitled note"]');
  const originalTitle = await title.inputValue();
  const source = await page.evaluate((currentTitle) => new Promise<{ id: string; title: string; content: string }>((resolve, reject) => {
    const request = indexedDB.open('marknote');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const notes = database.transaction('notes', 'readonly').objectStore('notes').getAll();
      notes.onsuccess = () => {
        const note = notes.result.find((item: { title: string }) => item.title === currentTitle);
        database.close();
        if (!note) reject(new Error('Selected original note was not found.'));
        else resolve({ id: note.id, title: note.title, content: note.content });
      };
      notes.onerror = () => reject(notes.error);
    };
  }), originalTitle);
  const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=';
  const savedBody = `<p>Original saved body must stay unchanged</p><img src="${imageData}" data-attachment-id="e2e-durable-image">`;
  await page.evaluate(({ sourceId, savedBody, imageData }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('marknote');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['notes', 'images'], 'readwrite');
      const notes = transaction.objectStore('notes');
      const get = notes.get(sourceId);
      get.onsuccess = () => notes.put({ ...get.result, content: savedBody, rawContent: 'Original saved body must stay unchanged', version: (get.result.version || 1) + 1 });
      transaction.objectStore('images').put({ id: 'e2e-durable-image', noteId: sourceId, data: imageData, mimeType: 'image/png', version: 1, remoteRevision: 0 });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { sourceId: source.id, savedBody, imageData });
  await page.reload();
  const editor = page.locator('[contenteditable=true]');
  await expect(editor).toContainText('Original saved body must stay unchanged');
  await expect(editor.locator('img')).toHaveAttribute('data-attachment-id', 'e2e-durable-image');
  // Persist editor drafts normally while refusing the final note commit in this document.
  // Reload removes the injected failure and exercises recovery from disk, not an autosave.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'notes') throw new DOMException('Injected note commit failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const draftTitle = 'Recovered after forced reopen';
  const draftBody = 'Durable unfinished body survives the forced reload';
  await title.fill(draftTitle);
  await editor.locator('p').first().fill(draftBody);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-error-banner')).toBeVisible();
  await expect.poll(async () => page.evaluate(({ draftTitle, draftBody }) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('marknote');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const drafts = database.transaction('editorDrafts', 'readonly').objectStore('editorDrafts').getAll();
      drafts.onsuccess = () => {
        resolve(drafts.result.some((draft: { title: string; content: string }) => draft.title === draftTitle && draft.content.includes(draftBody) && draft.content.includes('e2e-durable-image')));
        database.close();
      };
      drafts.onerror = () => reject(drafts.error);
    };
  }), { draftTitle, draftBody })).toBe(true);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.locator('[contenteditable=true]')).toBeVisible();
  const recoveredButton = page.getByRole('button', { name: draftTitle, exact: false }).first();
  await expect(recoveredButton).toBeVisible();
  await recoveredButton.click();
  await expect(editor).toContainText(draftBody);
  await expect(editor.locator('img')).toHaveAttribute('src', imageData);
  await expect(editor.locator('img')).not.toHaveAttribute('data-attachment-id', 'e2e-durable-image');
  const after = await page.evaluate((sourceId) => new Promise<{ original: { content: string }; copies: Array<{ id: string; content: string; title: string }>; images: Array<{ id: string; noteId: string; data: string }> }>((resolve, reject) => {
    const request = indexedDB.open('marknote');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['notes', 'images'], 'readonly');
      const notes = transaction.objectStore('notes').getAll();
      const images = transaction.objectStore('images').getAll();
      transaction.oncomplete = () => {
        database.close();
        resolve({ original: notes.result.find((note: { id: string }) => note.id === sourceId), copies: notes.result, images: images.result });
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }), source.id);
  expect(after.original.content).toBe(savedBody);
  const recovered = after.copies.find((note) => note.id !== source.id && note.title.startsWith(draftTitle));
  expect(recovered?.content).toContain(draftBody);
  expect(after.images.some((image) => image.noteId === recovered?.id && image.data === imageData && image.id !== 'e2e-durable-image')).toBe(true);
});

test('storage write failures keep the editor open and export the unfinished text', async ({ page }) => {
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'editorDrafts') throw new DOMException('Injected write failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.locator('input[placeholder="Untitled note"]').fill('Unsaved but recoverable');
  await page.locator('[contenteditable=true]').fill('Text must survive a failed database write');
  const error = page.locator('.save-error-banner');
  await expect(error).toBeVisible();
  const downloading = page.waitForEvent('download');
  await error.getByRole('button', { name: 'Export recovery file', exact: true }).click();
  const download = await downloading;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(download.suggestedFilename()).toMatch(/^marknote-recovery-.*\.json$/);
  expect(data.complete).toBe(false);
  expect(data.notes.some((note: { title: string; content: string }) => note.title.startsWith('Unsaved but recoverable') && note.content.includes('Text must survive a failed database write'))).toBe(true);
  expect(data.recovery.memoryDrafts.some((draft: { title: string; content: string }) => draft.title === 'Unsaved but recoverable' && draft.content.includes('Text must survive a failed database write'))).toBe(true);
  await expect(page.locator('[contenteditable=true]')).toContainText('Text must survive');
});

test('pinning during typing flushes edits without creating a false conflict', async ({ page }) => {
  await page.locator('input[placeholder="Untitled note"]').fill('Pin while typing');
  await page.locator('[contenteditable=true]').fill('Fresh text before metadata change');
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('[contenteditable=true]')).toContainText('Fresh text before metadata change');
  await expect(page.getByRole('button', { name: /Pin while typing.*冲突副本/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pin while typing', exact: true }).click();
  await expect(page.locator('[contenteditable=true]')).toContainText('Fresh text before metadata change');
});

test('worker search refresh preserves the selected editor node and typing focus', async ({ page }) => {
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    const attached = new WeakSet<Worker>();
    const probe = { sequence: 0, generation: 0, complete: false };
    (window as Window & { searchWorkerProbe?: typeof probe }).searchWorkerProbe = probe;
    Worker.prototype.postMessage = function (...args: Parameters<typeof original>) {
      const request = args[0] as { type?: string; sequence: number; generation: number };
      if (!attached.has(this)) {
        attached.add(this);
        this.addEventListener('message', (event) => {
          if (event.data.type === 'result' && event.data.sequence === probe.sequence && event.data.generation === probe.generation) probe.complete = true;
        });
      }
      if (request.type === 'query') {
        probe.sequence = request.sequence;
        probe.generation = request.generation;
        probe.complete = false;
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  const title = page.locator('input[placeholder="Untitled note"]');
  const editor = page.locator('[contenteditable=true]');
  await title.fill('Worker stable selection');
  await editor.fill('Saved searchable body');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('marknote');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const notes = database.transaction('notes', 'readonly').objectStore('notes').getAll();
      notes.onsuccess = () => {
        resolve(notes.result.some((note: { title: string; content: string }) => note.title === 'Worker stable selection' && note.content.includes('Saved searchable body')));
        database.close();
      };
      notes.onerror = () => reject(notes.error);
    };
  }))).toBe(true);
  await page.getByPlaceholder('Search notes, tags, code, or files').fill('Worker stable');
  await expect(page.getByRole('button', { name: 'Worker stable selection', exact: false }).first()).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (window as Window & { searchWorkerProbe?: { complete: boolean } }).searchWorkerProbe?.complete)).toBe(true);
  const beforeIndex = await page.evaluate(() => (window as Window & { searchWorkerProbe?: { sequence: number } }).searchWorkerProbe!.sequence);
  await expect(title).toHaveValue('Worker stable selection');
  await editor.click();
  await editor.press('Control+End');
  await page.evaluate(() => {
    (window as Window & { stableEditorNode?: Element }).stableEditorNode = document.querySelector('[contenteditable=true]')!;
  });
  await page.keyboard.type(' Fresh edits during worker reindex.');
  await expect.poll(async () => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('marknote');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const notes = database.transaction('notes', 'readonly').objectStore('notes').getAll();
      notes.onsuccess = () => {
        resolve(notes.result.some((note: { title: string; content: string }) => note.title === 'Worker stable selection' && note.content.includes('Fresh edits during worker reindex.')));
        database.close();
      };
      notes.onerror = () => reject(notes.error);
    };
  }))).toBe(true);
  // Wait for the real worker's new result, not merely the IndexedDB commit.
  await expect.poll(async () => page.evaluate((sequence) => {
    const probe = (window as Window & { searchWorkerProbe?: { sequence: number; complete: boolean } }).searchWorkerProbe;
    return Boolean(probe && probe.sequence > sequence && probe.complete);
  }, beforeIndex)).toBe(true);
  await expect(title).toHaveValue('Worker stable selection');
  await expect(editor).toContainText('Fresh edits during worker reindex.');
  await expect.poll(async () => page.evaluate(() => {
    const current = document.querySelector('[contenteditable=true]');
    return current === (window as Window & { stableEditorNode?: Element }).stableEditorNode
      && document.activeElement === current;
  })).toBe(true);
});
