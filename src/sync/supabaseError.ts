export interface SupabaseErrorLike {
  code?: unknown;
  message?: unknown;
}

export interface NetworkErrorDetail {
  code?: string;
  message: string;
  raw: string;
}

export function supabaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as SupabaseErrorLike).code || '')
    : undefined;
}

export function supabaseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as SupabaseErrorLike).message || '');
  }
  if (typeof error === 'object' && error !== null) {
    return '';
  }
  return String(error || '');
}

export function errorWithCauseMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts = [error.message];
  let cause = (error as Error & { cause?: unknown }).cause;
  while (cause instanceof Error) {
    const code = errorLikeCode(cause);
    parts.push(`caused by:${code ? ` ${code}` : ''} ${cause.message}`);
    cause = (cause as Error & { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

export function networkErrorDetail(error: unknown): NetworkErrorDetail | null {
  const raw = errorWithCauseMessage(error);
  const code = errorLikeCode(error) || firstCauseCode(error);
  if (!isNetworkErrorMessage(raw, code)) {
    return null;
  }
  return {
    code,
    message: networkErrorSummary(raw, code),
    raw,
  };
}

export function supabaseProjectReachabilityMessage(error: unknown): string {
  const network = networkErrorDetail(error);
  if (!network) {
    return `Supabase project could not be reached: ${errorWithCauseMessage(error)}`;
  }
  return [
    `Supabase project could not be reached before Auth/Data API checks could run: ${network.message}`,
    `Network detail: ${network.raw}`,
    'Check this network, VPN/proxy/firewall, DNS filtering, or whether the Supabase project endpoint is reachable from this machine.',
  ].join(' ');
}

export function isSupabaseNameResolutionError(error: unknown): boolean {
  const detail = networkErrorDetail(error);
  const value = `${detail?.code || ''} ${detail?.raw || errorWithCauseMessage(error)}`.toLowerCase();
  return value.includes('enotfound') || value.includes('could not resolve') || value.includes('name_not_resolved');
}

export function supabaseBackendErrorMessage(error: unknown, resource: string): string {
  const network = networkErrorDetail(error);
  if (network) {
    return [
      `${resource} could not be reached because the network request failed before Supabase returned a Data API or Storage response: ${network.message}`,
      `Network detail: ${network.raw}`,
      'Check this network, VPN/proxy/firewall, DNS filtering, or whether the Supabase project endpoint is reachable from this machine.',
    ].join(' ');
  }
  const code = supabaseErrorCode(error);
  const message = supabaseErrorMessage(error);
  if (code === 'PGRST301' || /(?:jwt|token).*(?:expired|invalid|rejected)|(?:expired|invalid|rejected).*(?:jwt|token)/i.test(message)) {
    return `${resource} could not be checked because the Supabase session token was rejected. Sign out and sign in again, then run Diagnose sync again.`;
  }
  if (code === 'PGRST205') {
    return [
      `${resource} is missing from the Supabase Data API schema cache, so MarkNote cannot read or write remote sync rows yet.`,
      'Apply supabase/migrations/202606190001_marknote_sync_schema.sql with the authenticated GRANT, RLS, and Storage policy sections, then rerun Diagnose sync.',
    ].join(' ');
  }
  if (code === '42501' || /permission denied/i.test(message)) {
    return `${resource} exists, but the signed-in role does not have the required Data API grants or RLS policy. Reapply the authenticated GRANT and RLS policy section of the sync migration.`;
  }
  if (/bucket/i.test(message) || /storage/i.test(message)) {
    return `${resource} is not reachable. Confirm the attachments Storage bucket exists and that authenticated users have SELECT, INSERT, UPDATE, and DELETE policies.`;
  }
  return message || `${resource} is not reachable.`;
}

export function isSupabaseStorageObjectMissingError(error: unknown): boolean {
  const code = supabaseErrorCode(error);
  const message = supabaseErrorMessage(error);
  if (code === '404' || code === 'NoSuchKey') {
    return true;
  }
  return /(?:object|key|file).*(?:not found|missing|does not exist)|(?:not found|missing|does not exist).*(?:object|key|file)/i.test(message);
}

function errorLikeCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

function firstCauseCode(error: unknown): string | undefined {
  let cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  while (cause instanceof Error) {
    const code = errorLikeCode(cause);
    if (code) {
      return code;
    }
    cause = (cause as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

function isNetworkErrorMessage(message: string, code?: string): boolean {
  const value = `${code || ''} ${message}`.toLowerCase();
  return [
    'failed to fetch',
    'fetch failed',
    'networkerror',
    'load failed',
    'network request failed',
    'econnreset',
    'econnrefused',
    'etimedout',
    'enotfound',
    'eai_again',
    'ssl_error_syscall',
    'tls',
    'secure tls connection',
    'could not resolve',
    'name_not_resolved',
  ].some((marker) => value.includes(marker));
}

function networkErrorSummary(message: string, code?: string): string {
  const value = `${code || ''} ${message}`.toLowerCase();
  if (value.includes('enotfound') || value.includes('could not resolve') || value.includes('name_not_resolved')) {
    return 'the Supabase hostname could not be resolved.';
  }
  if (value.includes('econnreset') || value.includes('ssl_error_syscall')) {
    return 'the TLS connection was reset during the handshake.';
  }
  if (value.includes('etimedout')) {
    return 'the connection timed out.';
  }
  if (value.includes('econnrefused')) {
    return 'the connection was refused.';
  }
  if (value.includes('tls') || value.includes('secure tls connection')) {
    return 'the TLS handshake failed.';
  }
  return 'the network request failed.';
}
