export function claimDesktopOAuthCallback(handledUrls: Set<string>, callbackUrl: string | null | undefined): string {
  if (!callbackUrl || handledUrls.has(callbackUrl)) {
    return '';
  }
  handledUrls.add(callbackUrl);
  return callbackUrl;
}

export function releaseDesktopOAuthCallback(handledUrls: Set<string>, callbackUrl: string): void {
  handledUrls.delete(callbackUrl);
}

export async function clearDesktopOAuthCallback(
  desktop: { clearAuthCallback?: (url: string) => Promise<void> } | undefined,
  callbackUrl: string,
): Promise<void> {
  try {
    await desktop?.clearAuthCallback?.(callbackUrl);
  } catch {
    // The session has already been established; stale Electron callback cleanup is best-effort.
  }
}
