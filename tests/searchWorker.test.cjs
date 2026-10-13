const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

async function main() {
  const timers = [];
  const replies = [];
  let handler;
  const exports = {};
  vm.runInNewContext(compile('src/lib/searchIndex.ts'), { exports, setTimeout: (callback) => timers.push(callback) });
  vm.runInNewContext(compile('src/workers/search.worker.ts'), {
    exports: {}, require: () => exports,
    addEventListener: (_type, callback) => { handler = callback; },
    postMessage: (reply) => replies.push(reply),
  });
  const records = Array.from({ length: 10_000 }, (_, index) => ({ id: `note-${index}`, text: `中文 ${index} ${index % 2 === 0 ? 'alpha' : 'beta'}` }));
  handler({ data: { type: 'sync', generation: 1, upserts: records, removed: [] } });
  handler({ data: { type: 'query', generation: 1, sequence: 1, query: 'alpha' } });
  handler({ data: { type: 'query', generation: 1, sequence: 2, query: 'beta' } });
  await drain(timers);
  assert.equal(replies.length, 1, 'Superseded queries must not publish stale or partial results');
  assert.equal(replies[0].sequence, 2);
  assert.equal(replies[0].generation, 1);
  assert.equal(replies[0].ids.length, 5_000);
  assert.ok(replies[0].ids.every((id) => Number(id.slice(5)) % 2 === 1));
  handler({ data: { type: 'query', generation: 1, sequence: 3, query: 'alpha' } });
  handler({ data: { type: 'sync', generation: 2, upserts: [{ id: 'note-1', text: '中文 updated alpha' }], removed: ['note-0'] } });
  handler({ data: { type: 'query', generation: 2, sequence: 4, query: 'updated' } });
  await drain(timers);
  assert.equal(replies.length, 2);
  assert.equal(replies[1].generation, 2);
  assert.equal(replies[1].sequence, 4);
  assert.equal(replies[1].ids.length, 1);
  assert.equal(replies[1].ids[0], 'note-1');
  handler({ data: { type: 'query', generation: 1, sequence: 5, query: 'alpha' } });
  await drain(timers);
  assert.equal(replies.length, 2, 'Queries for an obsolete index generation must be ignored');
  console.log('Search worker 10k query cancellation, incremental update and generation regression tests passed');
}

function compile(file) {
  return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
}

async function drain(timers) {
  for (let cycle = 0; cycle < 60; cycle += 1) {
    const callback = timers.shift();
    callback?.();
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(timers.length, 0);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
