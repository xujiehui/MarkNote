import type { AuthSession, SyncBackendCheckResult, SyncResult } from './types';

export interface SyncCurrentInput {
  lastResultOk: boolean;
  queuePending: number;
  queueFailed: number;
}

export function isSyncCurrent({ lastResultOk, queuePending, queueFailed }: SyncCurrentInput): boolean {
  return lastResultOk && queuePending === 0 && queueFailed === 0;
}

export function syncDisplayError(
  error: string,
  backendCheck: SyncBackendCheckResult | null,
  options?: { includeBackendCheck?: boolean },
): string {
  if (error) {
    return error;
  }
  if (!options?.includeBackendCheck) {
    return '';
  }
  return backendCheck?.items.find((item) => item.status === 'error')?.message || '';
}

export function formatBackendCheckReport(
  result: SyncBackendCheckResult,
  options?: { providerName?: string },
): string {
  const lines = [
    'MarkNote sync backend diagnosis',
    `Provider: ${options?.providerName || 'unknown'}`,
    `Checked at: ${new Date(result.checkedAt).toISOString()}`,
    `Overall: ${result.ok ? 'ok' : 'failed'}`,
    '',
    'Checks:',
  ];

  for (const item of result.items) {
    lines.push(`- [${item.status}] ${item.name}${item.code ? ` (${item.code})` : ''}: ${redactSensitiveText(item.message)}`);
  }
  appendBackendRemediation(lines, result);

  return lines.join('\n');
}

export interface SyncDiagnosisReportInput {
  providerName: string;
  configured: boolean;
  session: AuthSession | null;
  queue: {
    pending: number;
    failed: number;
    firstError: string;
  };
  lastResult: SyncResult | null;
  error: string;
  backendCheck: SyncBackendCheckResult | null;
}

export function formatSyncDiagnosisReport({
  providerName,
  configured,
  session,
  queue,
  lastResult,
  error,
  backendCheck,
}: SyncDiagnosisReportInput): string {
  const lines = [
    'MarkNote sync diagnosis',
    `Provider: ${providerName || 'unknown'}`,
    `Configured: ${configured ? 'yes' : 'no'}`,
    `Signed in: ${session ? 'yes' : 'no'}`,
    '',
    'Queue:',
    `- Pending: ${queue.pending}`,
    `- Failed: ${queue.failed}`,
  ];

  if (queue.firstError) {
    lines.push(`- First error: ${redactSensitiveText(queue.firstError)}`);
  }

  lines.push('', 'Last sync:');
  if (lastResult) {
    lines.push(
      `- Overall: ${lastResult.ok ? 'ok' : 'failed'}`,
      `- Pushed: ${lastResult.pushed}`,
      `- Pulled: ${lastResult.pulled}`,
    );
    if (lastResult.syncedAt) {
      lines.push(`- Synced at: ${new Date(lastResult.syncedAt).toISOString()}`);
    }
    if (lastResult.error) {
      lines.push(`- Error: ${redactSensitiveText(lastResult.error)}`);
    }
  } else {
    lines.push('- Overall: not run');
  }

  if (error) {
    lines.push('', `Current error: ${redactSensitiveText(error)}`);
  }

  lines.push('', 'Backend check:');
  if (backendCheck) {
    lines.push(
      `- Checked at: ${new Date(backendCheck.checkedAt).toISOString()}`,
      `- Overall: ${backendCheck.ok ? 'ok' : 'failed'}`,
      '- Checks:',
    );
    for (const item of backendCheck.items) {
      lines.push(`  - [${item.status}] ${item.name}${item.code ? ` (${item.code})` : ''}: ${redactSensitiveText(item.message)}`);
    }
    appendBackendRemediation(lines, backendCheck);
  } else {
    lines.push('- Overall: not run');
  }

  return lines.join('\n');
}

function appendBackendRemediation(lines: string[], result: SyncBackendCheckResult): void {
  const remediation = backendRemediationLines(result);
  if (!remediation.length) {
    return;
  }

  lines.push('', 'Next steps:');
  for (const line of remediation) {
    lines.push(`- ${redactSensitiveText(line)}`);
  }
}

function backendRemediationLines(result: SyncBackendCheckResult): string[] {
  const failedItems = result.items.filter((item) => item.status === 'error');
  if (failedItems.some((item) => item.code === 'PGRST205')) {
    return [
      'Remote sync tables are missing from the Supabase Data API schema cache or are not exposed to the authenticated role.',
      'With a Supabase personal access token: SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run verify:release:online:apply',
      'Without a token: npm run print:supabase-migration, paste the SQL into Supabase SQL Editor, then run npm run verify:release:online:manual.',
    ];
  }
  if (failedItems.some((item) => item.code === '42501' || /grants?|rls|policy/i.test(item.message))) {
    return [
      'The sync tables exist, but authenticated grants or RLS policies are not ready.',
      'Run SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run check:supabase-migration, then reapply the migration or its grant/RLS policy section.',
    ];
  }
  if (failedItems.some((item) => /bucket|storage/i.test(`${item.name} ${item.message}`))) {
    return [
      'The attachment Storage backend is not ready.',
      'Confirm the private attachments bucket exists and authenticated users have SELECT, INSERT, UPDATE, and DELETE storage policies.',
    ];
  }
  return [];
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g, '[redacted-supabase-key]')
    .replace(/\bsbp_[A-Za-z0-9_-]+\b/g, '[redacted-supabase-pat]');
}
