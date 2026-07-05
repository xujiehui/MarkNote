const OAUTH_SEARCH_KEYS = ['code', 'error', 'error_code', 'error_description'];
const OAUTH_HASH_KEYS = ['access_token', 'refresh_token', 'error', 'error_code', 'error_description'];
const consumedCallbackUrls = new Set<string>();

export function currentOAuthCallbackUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return isOAuthCallbackUrl(window.location.href) ? window.location.href : '';
}

export function consumeCurrentOAuthCallbackUrl(): string {
  const value = currentOAuthCallbackUrl();
  if (!value || consumedCallbackUrls.has(value)) {
    return '';
  }
  consumedCallbackUrls.add(value);
  replaceCurrentOAuthCallbackUrl(value);
  return value;
}

export function isOAuthCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    return OAUTH_SEARCH_KEYS.some((key) => url.searchParams.has(key)) || OAUTH_HASH_KEYS.some((key) => hash.has(key));
  } catch {
    return false;
  }
}

export function cleanOAuthCallbackUrl(value: string): string {
  const url = new URL(value);
  for (const key of OAUTH_SEARCH_KEYS) {
    url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

export function replaceCurrentOAuthCallbackUrl(value: string): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }
  window.history.replaceState(window.history.state, '', cleanOAuthCallbackUrl(value));
}
