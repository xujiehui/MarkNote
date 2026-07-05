import assert from 'node:assert/strict';
import {
  errorWithCauseMessage,
  isSupabaseStorageObjectMissingError,
  networkErrorDetail,
  supabaseBackendErrorMessage,
  supabaseErrorCode,
  supabaseErrorMessage,
  supabaseProjectReachabilityMessage,
} from '../src/sync/supabaseError';

assert.equal(supabaseErrorCode({ code: 'PGRST205', message: 'missing' }), 'PGRST205');
assert.equal(supabaseErrorCode({ code: 42501, message: 'permission denied' }), '42501');
assert.equal(supabaseErrorCode(new Error('network down')), undefined);
assert.equal(supabaseErrorMessage({ message: 'permission denied' }), 'permission denied');
assert.equal(supabaseErrorMessage(new Error('network down')), 'network down');
assert.equal(supabaseErrorMessage('bad'), 'bad');
assert.equal(supabaseErrorMessage({}), '');

const tlsCause = new Error('Client network socket disconnected before secure TLS connection was established') as Error & {
  code?: string;
};
tlsCause.code = 'ECONNRESET';
const fetchFailure = new Error('fetch failed') as Error & { cause?: unknown };
fetchFailure.cause = tlsCause;
assert.match(errorWithCauseMessage(fetchFailure), /caused by: ECONNRESET/);
assert.equal(networkErrorDetail(fetchFailure)?.code, 'ECONNRESET');
assert.match(networkErrorDetail(fetchFailure)?.message || '', /TLS connection was reset/);
assert.match(supabaseProjectReachabilityMessage(fetchFailure), /before Auth\/Data API checks could run/);
assert.match(supabaseProjectReachabilityMessage(fetchFailure), /VPN\/proxy\/firewall/);

assert.match(
  supabaseBackendErrorMessage({ code: 'PGRST301', message: 'JWT expired' }, 'Notes table'),
  /session token was rejected/,
);
assert.match(
  supabaseBackendErrorMessage({ code: 'PGRST205', message: 'schema cache' }, 'Notes table'),
  /cannot read or write remote sync rows/,
);
assert.match(
  supabaseBackendErrorMessage({ code: '42501', message: 'permission denied for table notes' }, 'Notes table'),
  /Data API grants or RLS policy/,
);
assert.match(
  supabaseBackendErrorMessage({ message: 'Storage bucket not found' }, 'Attachments bucket'),
  /SELECT, INSERT, UPDATE, and DELETE policies/,
);
assert.match(
  supabaseBackendErrorMessage(fetchFailure, 'Notes table'),
  /network request failed before Supabase returned a Data API or Storage response/,
);
assert.equal(isSupabaseStorageObjectMissingError({ code: '404', message: 'Object not found' }), true);
assert.equal(isSupabaseStorageObjectMissingError({ code: 'NoSuchKey', message: 'The specified key does not exist' }), true);
assert.equal(isSupabaseStorageObjectMissingError({ message: 'storage object does not exist' }), true);
assert.equal(isSupabaseStorageObjectMissingError({ message: 'Storage bucket not found' }), false);
assert.equal(isSupabaseStorageObjectMissingError({ code: '42501', message: 'permission denied for storage object' }), false);
assert.equal(supabaseBackendErrorMessage({ message: 'custom failure' }, 'Notes table'), 'custom failure');
assert.equal(supabaseBackendErrorMessage({}, 'Notes table'), 'Notes table is not reachable.');

console.log('supabase error tests passed');
