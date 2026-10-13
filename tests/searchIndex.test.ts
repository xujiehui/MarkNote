import assert from 'node:assert/strict';
import { SearchIndex, SearchController, configureSearchWorker, createSearchController, type IndexedSearchState, type SearchRecord, type SearchWorkerPort, type SearchWorkerRequest } from '../src/lib/searchIndex';

class FakeWorker extends EventTarget implements SearchWorkerPort {
  messages: SearchWorkerRequest[] = [];
  terminated = false;
  failPost = false;
  postMessage(message: SearchWorkerRequest) { if (this.failPost) throw new Error('Worker unavailable'); this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(generation: number, sequence: number, ids: string[]) { this.dispatchEvent(new MessageEvent('message', { data: { type: 'result', generation, sequence, ids } })); }
}

async function main() {
  const index = new SearchIndex();
  index.applySync({ type: 'sync', generation: 1, removed: [], upserts: [
    { id: 'a', text: 'First 中文计划 Café' }, { id: 'b', text: 'Second documentation' },
  ] });
  assert.deepEqual([...index.search(' 中文计 ')], ['a']);
  assert.deepEqual([...index.search('CAFÉ')], ['a']);
  assert.deepEqual([...index.search('cafe')], [], 'Do not silently change accent-sensitive legacy semantics');
  assert.deepEqual([...index.search('cument')], ['b'], 'Partial word matches remain supported');
  index.applySync({ type: 'sync', generation: 2, removed: ['b'], upserts: [{ id: 'a', text: 'Changed final draft' }] });
  assert.equal(index.size, 1);
  assert.deepEqual([...index.search('中文')], []);
  assert.deepEqual([...index.search('final')], ['a']);
  assert.equal(index.applySync({ type: 'sync', generation: 1, removed: ['a'], upserts: [] }), false);
  assert.equal(index.size, 1, 'Stale index updates must be ignored');

  const worker = new FakeWorker();
  const states: IndexedSearchState[] = [];
  const controller = new SearchController(worker, (state) => states.push(state));
  const first = [{ id: 'a', text: 'First draft', version: 1 }, { id: 'b', text: 'Second draft', version: 1 }];
  controller.update(first, 'First');
  const firstQuery = worker.messages.find((message) => message.type === 'query')!;
  assert.equal(firstQuery.type, 'query');
  controller.update(first, 'Second');
  assert.equal(worker.messages.filter((message) => message.type === 'sync').length, 1, 'Typing a query must not rebuild or retransmit an unchanged index');
  const secondQuery = worker.messages.at(-1)!;
  assert.equal(secondQuery.type, 'query');
  worker.reply(secondQuery.generation, secondQuery.sequence, ['b']);
  assert.deepEqual([...states.at(-1)!.matches!], ['b']);
  const stateCount = states.length;
  worker.reply(firstQuery.generation, firstQuery.sequence, ['a']);
  assert.equal(states.length, stateCount, 'Late responses from earlier queries must not replace current matches');

  const changed = [{ id: 'a', text: 'Third revision', version: 2 }];
  controller.update(changed, 'Third');
  const sync = worker.messages.at(-2)!;
  assert.equal(sync.type, 'sync');
  assert.deepEqual(sync.upserts.map((record) => record.id), ['a']);
  assert.deepEqual(sync.removed, ['b']);
  const thirdQuery = worker.messages.at(-1)!;
  assert.equal(thirdQuery.type, 'query');
  const pendingCount = states.length;
  worker.reply(secondQuery.generation, thirdQuery.sequence, ['b']);
  assert.equal(states.length, pendingCount, 'Even a matching sequence must not accept an obsolete index generation');
  worker.reply(thirdQuery.generation, thirdQuery.sequence, ['a']);
  assert.deepEqual([...states.at(-1)!.matches!], ['a']);
  assert.equal(states.at(-1)!.records, changed);
  controller.update(changed, '');
  assert.equal(states.at(-1)!.pending, false);
  assert.equal(states.at(-1)!.matches, null);
  worker.reply(thirdQuery.generation, thirdQuery.sequence, ['a']);
  assert.equal(states.at(-1)!.matches, null, 'Clearing the query must invalidate previous replies');
  controller.dispose();
  assert.equal(worker.terminated, true);

  const failingWorker = new FakeWorker();
  const fallbackStates: IndexedSearchState[] = [];
  const fallback = new SearchController(failingWorker, (state) => fallbackStates.push(state));
  fallback.update(first, 'First');
  failingWorker.dispatchEvent(new Event('error', { cancelable: true }));
  assert.deepEqual([...fallbackStates.at(-1)!.matches!], ['a']);
  assert.equal(fallbackStates.at(-1)!.pending, false);
  fallback.update(changed, 'third');
  assert.deepEqual([...fallbackStates.at(-1)!.matches!], ['a']);
  fallback.dispose();
  configureSearchWorker(() => { throw new Error('Unsupported Worker'); });
  const unavailable = createSearchController((state) => fallbackStates.push(state));
  unavailable.update(first, 'second');
  assert.deepEqual([...fallbackStates.at(-1)!.matches!], ['b']);
  unavailable.dispose();
  configureSearchWorker(null);

  const many: SearchRecord[] = Array.from({ length: 10_000 }, (_, i) => ({ id: `note-${i}`, text: `Record ${i} 中文 résumé ${i % 17 === 0 ? 'needle' : 'ordinary'}` }));
  const large = new SearchIndex();
  large.applySync({ type: 'sync', generation: 1, upserts: many, removed: [] });
  assert.equal(large.size, 10_000);
  const expected = many.filter((record) => record.text.toLowerCase().includes('needle')).map((record) => record.id);
  assert.deepEqual([...(await large.searchAsync('needle', { yieldControl: async () => undefined }))!], expected);
  let current = true;
  let yields = 0;
  const aborted = await large.searchAsync('needle', { yieldControl: async () => { yields += 1; if (yields === 2) current = false; }, shouldContinue: () => current });
  assert.equal(aborted, null, 'A superseded 10k query should stop between batches without publishing partial matches');
  assert.equal(yields, 2);
  let migrated = false;
  const modified = await large.searchAsync('needle', { yieldControl: async () => { if (!migrated) { migrated = true; large.applySync({ type: 'sync', generation: 2, upserts: [], removed: ['note-0'] }); } } });
  assert.equal(modified, null, 'Results spanning two index generations must be discarded');
  console.log('Incremental indexed substring search, generation/sequence guards and 10k cancellation tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
