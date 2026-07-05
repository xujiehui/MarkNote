import assert from 'node:assert/strict';
import {
  DEEP_LINK_PROTOCOL,
  createAuthCallbackState,
  findAuthCallbackUrl,
  isAuthCallbackUrl,
} from '../electron/authCallbackState';

function main() {
  assert.equal(DEEP_LINK_PROTOCOL, 'marknote');
  assert.equal(isAuthCallbackUrl('marknote://auth/callback?code=abc'), true);
  assert.equal(isAuthCallbackUrl('marknote://auth/callback#error=access_denied'), true);
  assert.equal(isAuthCallbackUrl('marknote://auth/callback-extra?code=abc'), false);
  assert.equal(isAuthCallbackUrl('marknote://auth/callback/nested?code=abc'), false);
  assert.equal(isAuthCallbackUrl('marknote://settings'), false);
  assert.equal(isAuthCallbackUrl('https://example.com/auth/callback?code=abc'), false);
  assert.equal(isAuthCallbackUrl('not a url'), false);

  assert.equal(
    findAuthCallbackUrl(['MarkNote', '--flag', 'marknote://auth/callback?code=abc']),
    'marknote://auth/callback?code=abc',
  );
  assert.equal(
    findAuthCallbackUrl(['MarkNote', 'marknote://auth/callback-extra?code=bad', 'marknote://auth/callback?code=good']),
    'marknote://auth/callback?code=good',
  );
  assert.equal(findAuthCallbackUrl(['MarkNote', 'https://example.com']), '');

  const state = createAuthCallbackState('marknote://auth/callback?code=cold-start');
  assert.equal(state.pending, 'marknote://auth/callback?code=cold-start');
  assert.equal(state.clear('marknote://auth/callback?code=other'), false);
  assert.equal(state.pending, 'marknote://auth/callback?code=cold-start');
  assert.equal(state.peek(), 'marknote://auth/callback?code=cold-start');
  assert.equal(state.peek(), 'marknote://auth/callback?code=cold-start');
  assert.equal(state.consume(), 'marknote://auth/callback?code=cold-start');
  assert.equal(state.consume(), null);

  assert.equal(state.setPending('https://example.com/auth/callback'), false);
  assert.equal(state.pending, null);
  assert.equal(state.setPending('marknote://auth/callback#access_token=access'), true);
  assert.equal(state.peek(), 'marknote://auth/callback#access_token=access');
  assert.equal(state.clear('marknote://auth/callback#access_token=access'), true);
  assert.equal(state.pending, null);

  console.log('electron auth callback tests passed');
}

main();
