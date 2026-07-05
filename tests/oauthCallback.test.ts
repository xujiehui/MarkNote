import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  cleanOAuthCallbackUrl,
  consumeCurrentOAuthCallbackUrl,
  currentOAuthCallbackUrl,
  isOAuthCallbackUrl,
  replaceCurrentOAuthCallbackUrl,
} from '../src/sync/oauthCallback';

const callbackUrl = 'http://127.0.0.1:5173/?app=1&code=code-1';
assert.equal(isOAuthCallbackUrl(callbackUrl), true);
assert.equal(cleanOAuthCallbackUrl(callbackUrl), 'http://127.0.0.1:5173/?app=1');

const errorUrl = 'http://127.0.0.1:5173/?app=1#error=access_denied&error_description=Denied';
assert.equal(isOAuthCallbackUrl(errorUrl), true);
assert.equal(cleanOAuthCallbackUrl(errorUrl), 'http://127.0.0.1:5173/?app=1');

const ordinaryUrl = 'http://127.0.0.1:5173/?app=1&note=note-1';
assert.equal(isOAuthCallbackUrl(ordinaryUrl), false);
assert.equal(isOAuthCallbackUrl('not a url'), false);

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: callbackUrl,
});

Object.assign(globalThis, {
  window: dom.window,
});

assert.equal(currentOAuthCallbackUrl(), callbackUrl);
replaceCurrentOAuthCallbackUrl(callbackUrl);
assert.equal(window.location.href, 'http://127.0.0.1:5173/?app=1');

const consumeUrl = 'http://127.0.0.1:5173/?app=1&code=code-2';
window.history.replaceState(window.history.state, '', consumeUrl);
assert.equal(consumeCurrentOAuthCallbackUrl(), consumeUrl);
assert.equal(window.location.href, 'http://127.0.0.1:5173/?app=1');
window.history.replaceState(window.history.state, '', consumeUrl);
assert.equal(consumeCurrentOAuthCallbackUrl(), '');

console.log('oauth callback tests passed');
