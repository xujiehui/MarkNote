export function errorWithCauseMessage(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts = [error.message];
  let cause = error.cause;
  while (cause instanceof Error) {
    const code = typeof cause.code === 'string' && cause.code ? ` ${cause.code}` : '';
    parts.push(`caused by:${code} ${cause.message}`);
    cause = cause.cause;
  }
  return parts.join(' | ');
}

export function supabaseProjectReachabilityMessage(error) {
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

export function oauthEndpointReachabilityMessage(endpoint, error) {
  const network = networkErrorDetail(error);
  if (!network) {
    return `${endpoint} could not be reached: ${errorWithCauseMessage(error)}`;
  }
  return [
    `${endpoint} could not be reached: ${network.message}`,
    `Network detail: ${network.raw}`,
    'Check this network, VPN/proxy/firewall, DNS filtering, or whether the OAuth endpoint is reachable from this machine.',
  ].join(' ');
}

export function networkErrorDetail(error) {
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

function errorLikeCode(error) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' && error.code ? error.code : undefined;
}

function firstCauseCode(error) {
  let cause = error instanceof Error ? error.cause : undefined;
  while (cause instanceof Error) {
    const code = errorLikeCode(cause);
    if (code) {
      return code;
    }
    cause = cause.cause;
  }
  return undefined;
}

function isNetworkErrorMessage(message, code) {
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

function networkErrorSummary(message, code) {
  const value = `${code || ''} ${message}`.toLowerCase();
  if (value.includes('enotfound') || value.includes('could not resolve') || value.includes('name_not_resolved')) {
    return 'the hostname could not be resolved.';
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
