import assert from 'node:assert/strict';
import {
  claimDesktopOAuthCallback,
  clearDesktopOAuthCallback,
  releaseDesktopOAuthCallback,
} from '../src/sync/desktopOAuthCallback';

async function main() {
  const handled = new Set<string>();

  assert.equal(claimDesktopOAuthCallback(handled, null), '');
  assert.equal(claimDesktopOAuthCallback(handled, undefined), '');
  assert.equal(claimDesktopOAuthCallback(handled, ''), '');

  assert.equal(claimDesktopOAuthCallback(handled, 'marknote://auth/callback?code=one'), 'marknote://auth/callback?code=one');
  assert.equal(claimDesktopOAuthCallback(handled, 'marknote://auth/callback?code=one'), '');

  releaseDesktopOAuthCallback(handled, 'marknote://auth/callback?code=one');
  assert.equal(claimDesktopOAuthCallback(handled, 'marknote://auth/callback?code=one'), 'marknote://auth/callback?code=one');

  let clearedUrl = '';
  await clearDesktopOAuthCallback(
    {
      clearAuthCallback: async (url) => {
        clearedUrl = url;
      },
    },
    'marknote://auth/callback?code=one',
  );
  assert.equal(clearedUrl, 'marknote://auth/callback?code=one');

  await clearDesktopOAuthCallback(
    {
      clearAuthCallback: async () => {
        throw new Error('ipc unavailable');
      },
    },
    'marknote://auth/callback?code=one',
  );

  console.log('desktop oauth callback tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
