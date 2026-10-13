import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useIndexedSearch } from '../src/hooks/useIndexedSearch';
import { configureSearchWorker, type SearchRecord, type SearchWorkerPort, type SearchWorkerRequest } from '../src/lib/searchIndex';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
installDomGlobals({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true });

class FakeWorker extends dom.window.EventTarget implements SearchWorkerPort {
  messages: SearchWorkerRequest[] = [];
  terminated = false;
  postMessage(message: SearchWorkerRequest) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(request: Extract<SearchWorkerRequest, { type: 'query' }>, ids: string[], generation = request.generation) {
    this.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'result', generation, sequence: request.sequence, ids } }));
  }
}

function Results({ records, query }: { records: SearchRecord[]; query: string }) {
  const state = useIndexedSearch(records, query);
  return <output data-pending={String(state.pending)} data-ids={state.matches ? [...state.matches].join(',') : ''} />;
}

async function main() {
  const workers: FakeWorker[] = [];
  configureSearchWorker(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const root = createRoot(document.getElementById('root')!);
  const initial = [{ id: 'a', text: 'First 中文计划' }, { id: 'b', text: 'Second Café' }];
  await act(async () => root.render(<React.StrictMode><Results records={initial} query="first" /></React.StrictMode>));
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true, 'StrictMode cleanup must terminate the first worker');
  const worker = workers[1];
  const output = () => document.querySelector('output')!;
  const latest = () => worker.messages.at(-1) as Extract<SearchWorkerRequest, { type: 'query' }>;
  const first = latest();
  assert.equal(output().getAttribute('data-pending'), 'true');
  await act(async () => worker.reply(first, ['a']));
  assert.equal(output().getAttribute('data-ids'), 'a');
  assert.equal(output().getAttribute('data-pending'), 'false');

  await act(async () => root.render(<React.StrictMode><Results records={initial} query="second" /></React.StrictMode>));
  const second = latest();
  assert.equal(output().getAttribute('data-ids'), '', 'Changed query props must not display the previous result');
  assert.equal(output().getAttribute('data-pending'), 'true');
  await act(async () => worker.reply(first, ['a']));
  assert.equal(output().getAttribute('data-pending'), 'true');
  await act(async () => worker.reply(second, ['b']));
  assert.equal(output().getAttribute('data-ids'), 'b');

  const changed = [{ id: 'a', text: 'Second revised' }];
  await act(async () => root.render(<React.StrictMode><Results records={changed} query="second" /></React.StrictMode>));
  const third = latest();
  assert.equal(output().getAttribute('data-ids'), '');
  await act(async () => worker.reply(third, ['b'], second.generation));
  assert.equal(output().getAttribute('data-pending'), 'true');
  await act(async () => worker.reply(third, ['a']));
  assert.equal(output().getAttribute('data-ids'), 'a');
  await act(async () => root.render(<React.StrictMode><Results records={changed} query=" " /></React.StrictMode>));
  assert.equal(output().getAttribute('data-pending'), 'false');
  assert.equal(output().getAttribute('data-ids'), '');
  await act(async () => worker.reply(third, ['a']));
  assert.equal(output().getAttribute('data-ids'), '');
  await act(async () => root.unmount());
  assert.equal(worker.terminated, true);

  configureSearchWorker(() => { throw new Error('Worker unsupported'); });
  const fallback = createRoot(document.getElementById('root')!);
  await act(async () => fallback.render(<Results records={initial} query="中文计" />));
  assert.equal(output().getAttribute('data-pending'), 'false');
  assert.equal(output().getAttribute('data-ids'), 'a');
  await act(async () => fallback.unmount());
  configureSearchWorker(null);
  console.log('Indexed search hook stale-prop, StrictMode disposal and unsupported-worker fallback tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
