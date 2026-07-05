import assert from 'node:assert/strict';
import { formatBackendCheckReport, formatSyncDiagnosisReport, isSyncCurrent, syncDisplayError } from '../src/sync/syncDisplayStatus';
import type { SyncBackendCheckResult } from '../src/sync/types';

const backendCheck: SyncBackendCheckResult = {
  ok: false,
  checkedAt: 1,
  items: [
    {
      name: 'Auth session',
      status: 'ok',
      message: 'Signed in.',
    },
    {
      name: 'Notes table',
      status: 'error',
      message: 'Apply the MarkNote sync schema migration.',
      code: 'PGRST205',
    },
  ],
};

assert.equal(syncDisplayError('Push failed.', backendCheck), 'Push failed.');
assert.equal(syncDisplayError('', backendCheck), '');
assert.equal(syncDisplayError('', backendCheck, { includeBackendCheck: true }), 'Apply the MarkNote sync schema migration.');
assert.equal(syncDisplayError('', { ...backendCheck, ok: true, items: backendCheck.items.slice(0, 1) }), '');
assert.equal(syncDisplayError('', null), '');

assert.equal(isSyncCurrent({ lastResultOk: true, queuePending: 0, queueFailed: 0 }), true);
assert.equal(isSyncCurrent({ lastResultOk: false, queuePending: 0, queueFailed: 0 }), false);
assert.equal(isSyncCurrent({ lastResultOk: true, queuePending: 1, queueFailed: 0 }), false);
assert.equal(isSyncCurrent({ lastResultOk: true, queuePending: 1, queueFailed: 1 }), false);

const report = formatBackendCheckReport(backendCheck, { providerName: 'Supabase' });
assert.match(report, /MarkNote sync backend diagnosis/);
assert.match(report, /Provider: Supabase/);
assert.match(report, /Checked at: 1970-01-01T00:00:00.001Z/);
assert.match(report, /Overall: failed/);
assert.match(report, /- \[ok\] Auth session: Signed in\./);
assert.match(report, /- \[error\] Notes table \(PGRST205\): Apply the MarkNote sync schema migration\./);
assert.match(report, /Next steps:/);
assert.match(report, /Remote sync tables are missing from the Supabase Data API schema cache/);
assert.match(report, /SUPABASE_MANAGEMENT_TOKEN=sbp_\.\.\. npm run verify:release:online:apply/);
assert.match(report, /npm run print:supabase-migration/);

const syncReport = formatSyncDiagnosisReport({
  providerName: 'Supabase',
  configured: true,
  session: { user: { id: 'user-1', email: 'google@example.com' } },
  queue: {
    pending: 2,
    failed: 1,
    firstError: 'Could not push notes: permission denied for token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature',
  },
  lastResult: {
    ok: false,
    pushed: 0,
    pulled: 1,
    syncedAt: 1_725_000_000_000,
    error: 'Could not upload with key sb_publishable_abcdefghijklmnopqrstuvwxyz.',
  },
  error: 'Current sync failed.',
  backendCheck,
});
assert.match(syncReport, /MarkNote sync diagnosis/);
assert.match(syncReport, /Provider: Supabase/);
assert.match(syncReport, /Configured: yes/);
assert.match(syncReport, /Signed in: yes/);
assert.match(syncReport, /- Pending: 2/);
assert.match(syncReport, /- Failed: 1/);
assert.match(syncReport, /- First error: Could not push notes: permission denied for token \[redacted-jwt\]/);
assert.match(syncReport, /Last sync:/);
assert.match(syncReport, /- Overall: failed/);
assert.match(syncReport, /- Pushed: 0/);
assert.match(syncReport, /- Pulled: 1/);
assert.match(syncReport, /- Synced at: 2024-08-30T06:40:00.000Z/);
assert.match(syncReport, /Current error: Current sync failed\./);
assert.match(syncReport, /Backend check:/);
assert.match(syncReport, / {2}- \[error\] Notes table \(PGRST205\): Apply the MarkNote sync schema migration\./);
assert.match(syncReport, /Next steps:/);
assert.match(syncReport, /npm run verify:release:online:manual/);
assert.doesNotMatch(syncReport, /eyJhbGciOiJIUzI1NiJ9/);
assert.doesNotMatch(syncReport, /sb_publishable_abcdefghijklmnopqrstuvwxyz/);
assert.match(syncReport, /\[redacted-jwt\]/);
assert.match(syncReport, /\[redacted-supabase-key\]/);

const notRunReport = formatSyncDiagnosisReport({
  providerName: 'Supabase',
  configured: false,
  session: null,
  queue: { pending: 0, failed: 0, firstError: '' },
  lastResult: null,
  error: '',
  backendCheck: null,
});
assert.match(notRunReport, /Configured: no/);
assert.match(notRunReport, /Signed in: no/);
assert.match(notRunReport, /- Overall: not run/);

const sensitiveReport = formatBackendCheckReport(
  {
    ok: false,
    checkedAt: 2,
    items: [
      {
        name: 'Auth session',
        status: 'error',
        message:
          'Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature was rejected for key sb_publishable_abcdefghijklmnopqrstuvwxyz and PAT sbp_abcdefghijklmnopqrstuvwxyz.',
      },
    ],
  },
  { providerName: 'Supabase' },
);
assert.doesNotMatch(sensitiveReport, /eyJhbGciOiJIUzI1NiJ9/);
assert.doesNotMatch(sensitiveReport, /sb_publishable_abcdefghijklmnopqrstuvwxyz/);
assert.doesNotMatch(sensitiveReport, /sbp_abcdefghijklmnopqrstuvwxyz/);
assert.match(sensitiveReport, /\[redacted-jwt\]/);
assert.match(sensitiveReport, /\[redacted-supabase-key\]/);
assert.match(sensitiveReport, /\[redacted-supabase-pat\]/);

console.log('sync display status tests passed');
