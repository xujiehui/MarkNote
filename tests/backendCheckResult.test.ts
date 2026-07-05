import assert from 'node:assert/strict';
import { backendCheckFailureResult } from '../src/sync/backendCheckResult';

const errorResult = backendCheckFailureResult('Supabase', new Error('network down'), 123);
assert.equal(errorResult.ok, false);
assert.equal(errorResult.checkedAt, 123);
assert.deepEqual(errorResult.items, [
  {
    name: 'Supabase',
    status: 'error',
    message: 'network down',
  },
]);

const unknownResult = backendCheckFailureResult('Custom', 'bad', 456);
assert.equal(unknownResult.items[0].message, 'Backend diagnostics failed.');

console.log('backend check result tests passed');
