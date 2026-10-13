import assert from 'node:assert/strict';
import { isAllowedPreviewFrame, isAllowedRendererPermission, isTrustedIpcSender, isTrustedRendererUrl, PRODUCTION_CSP, safeExternalUrl, trustedDevelopmentUrl } from '../electron/securityPolicy';

const appUrl = 'file:///app/dist/index.html?app=1';
for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'marknote://settings', 'ms-settings:foo', 'https://user:pass@example.com', 'https://example.com/\nfoo', 'not a url']) {
  assert.equal(safeExternalUrl(url), null, url);
}
assert.equal(safeExternalUrl({ href: 'https://example.com' }), null);
assert.equal(safeExternalUrl('https://example.com/oauth?redirect_uri=marknote%3A%2F%2Fauth%2Fcallback'), 'https://example.com/oauth?redirect_uri=marknote%3A%2F%2Fauth%2Fcallback');
assert.equal(safeExternalUrl('http://example.com/help'), 'http://example.com/help');
assert.equal(safeExternalUrl('mailto:a@example.com'), 'mailto:a@example.com');
assert.equal(safeExternalUrl('mailto:a@example.com?subject=x%0AInjected'), null);

assert.equal(isTrustedRendererUrl('file:///app/dist/index.html?app=1#notes', appUrl), true);
for (const url of ['file:///app/dist/other.html', 'file://evil.example/app/dist/index.html', 'https://evil.example/index.html', 'about:blank']) {
  assert.equal(isTrustedRendererUrl(url, appUrl), false, url);
}
assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/?app=1', 'http://127.0.0.1:5173/'), true);
assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/evil.html', 'http://127.0.0.1:5173/'), false);
assert.equal(isTrustedRendererUrl('http://localhost:5173/', 'http://127.0.0.1:5173/'), false);
assert.equal(trustedDevelopmentUrl('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/?app=1');
assert.throws(() => trustedDevelopmentUrl('https://evil.example/'));
assert.throws(() => trustedDevelopmentUrl('file:///tmp/index.html'));

const sender = { webContentsId: 1, expectedWebContentsId: 1, frameId: 2, mainFrameId: 2, frameUrl: appUrl };
assert.equal(isTrustedIpcSender(sender, appUrl), true);
assert.equal(isTrustedIpcSender({ ...sender, frameId: 3 }, appUrl), false);
assert.equal(isTrustedIpcSender({ ...sender, webContentsId: 3 }, appUrl), false);
assert.equal(isTrustedIpcSender({ ...sender, frameUrl: 'https://evil.example/' }, appUrl), false);
assert.equal(isTrustedIpcSender({ ...sender, frameId: null }, appUrl), false);
assert.equal(isAllowedRendererPermission('clipboard-sanitized-write', true, appUrl, appUrl), true);
assert.equal(isAllowedRendererPermission('fullscreen', true, appUrl, appUrl), true);
for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'fileSystem']) {
  assert.equal(isAllowedRendererPermission(permission, true, appUrl, appUrl), false);
}
assert.equal(isAllowedRendererPermission('fullscreen', false, appUrl, appUrl), false);
assert.equal(isAllowedRendererPermission('fullscreen', true, 'https://evil.example/', appUrl), false);
assert.equal(isAllowedPreviewFrame('about:srcdoc', true, appUrl, appUrl), true);
assert.equal(isAllowedPreviewFrame('about:blank', true, appUrl, appUrl), true);
assert.equal(isAllowedPreviewFrame('about:srcdoc', false, appUrl, appUrl), false);
assert.equal(isAllowedPreviewFrame('https://evil.example/', true, appUrl, appUrl), false);
assert.equal(isAllowedPreviewFrame('about:srcdoc', true, 'https://evil.example/', appUrl), false);
assert.match(PRODUCTION_CSP, /script-src 'self'/);
assert.doesNotMatch(PRODUCTION_CSP, /unsafe-eval/);
assert.match(PRODUCTION_CSP, /object-src 'none'/);
console.log('electron security tests passed');
