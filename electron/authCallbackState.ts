export const DEEP_LINK_PROTOCOL = 'marknote';

export function isAuthCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === `${DEEP_LINK_PROTOCOL}:` && url.hostname === 'auth' && url.pathname === '/callback';
  } catch {
    return false;
  }
}

export function findAuthCallbackUrl(argv: readonly string[]): string {
  return argv.find((arg) => isAuthCallbackUrl(arg)) || '';
}

export function createAuthCallbackState(initialUrl = '') {
  let pendingAuthCallbackUrl = initialUrl || null;

  return {
    get pending() {
      return pendingAuthCallbackUrl;
    },
    setPending(url: string) {
      if (!isAuthCallbackUrl(url)) {
        return false;
      }
      pendingAuthCallbackUrl = url;
      return true;
    },
    clear(url: string) {
      if (pendingAuthCallbackUrl === url) {
        pendingAuthCallbackUrl = null;
        return true;
      }
      return false;
    },
    peek() {
      return pendingAuthCallbackUrl;
    },
    consume() {
      const value = pendingAuthCallbackUrl;
      pendingAuthCallbackUrl = null;
      return value;
    },
  };
}
