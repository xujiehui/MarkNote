export const PRODUCTION_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:", "worker-src 'self' blob:",
  "object-src 'none'", "frame-src 'self'", "base-uri 'none'", "form-action 'none'",
].join('; ');

/** Only ordinary web links and mail addresses may cross the OS shell boundary. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192
    || Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password) {
      return url.href;
    }
    if (url.protocol === 'mailto:' && url.pathname && !/%0[ad]/i.test(value)) return url.href;
  } catch {
    return null;
  }
  return null;
}

export function isTrustedRendererUrl(value: string, appUrl: string): boolean {
  try {
    const url = new URL(value);
    const expected = new URL(appUrl);
    return !url.username && !url.password && url.protocol === expected.protocol
      && url.host === expected.host && url.pathname === expected.pathname;
  } catch {
    return false;
  }
}

export function trustedDevelopmentUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('The desktop development server must use a loopback HTTP(S) URL.');
  }
  url.searchParams.set('app', '1');
  return url.href;
}

/** Require both the actual WebContents identity and its main frame, never URL alone. */
export function isTrustedIpcSender(sender: {
  webContentsId: number;
  expectedWebContentsId: number;
  frameId: number | null;
  mainFrameId: number;
  frameUrl: string;
}, appUrl: string): boolean {
  return sender.webContentsId === sender.expectedWebContentsId && sender.frameId === sender.mainFrameId
    && isTrustedRendererUrl(sender.frameUrl, appUrl);
}

export function isAllowedRendererPermission(permission: string, isMainFrame: boolean, requestingUrl: string, appUrl: string): boolean {
  return isMainFrame && isTrustedRendererUrl(requestingUrl, appUrl)
    && ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
}

/** An app-created sandboxed PDF preview is the only supported embedded document. */
export function isAllowedPreviewFrame(url: string, isDirectChild: boolean, initiatorUrl: string, appUrl: string): boolean {
  return isDirectChild && ['about:blank', 'about:srcdoc'].includes(url) && isTrustedRendererUrl(initiatorUrl, appUrl);
}
