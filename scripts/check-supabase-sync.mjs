
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { GoTrueClient } from '@supabase/auth-js';
import { errorWithCauseMessage, supabaseProjectReachabilityMessage } from './supabase-network-diagnostics.mjs';

const TABLES = ['profiles', 'devices', 'folders', 'notes', 'attachments'];
const env = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
  ...process.env,
};

const supabaseUrl = env.VITE_SUPABASE_URL;
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const accessToken = env.SUPABASE_ACCESS_TOKEN;
const oauthLogin = process.argv.includes('--oauth-login') || env.MARKNOTE_SUPABASE_OAUTH_LOGIN === '1';
const requireAuthenticatedCheck =
  process.argv.includes('--require-auth') ||
  env.MARKNOTE_REQUIRE_SUPABASE_ACCESS_TOKEN === '1' ||
  env.MARKNOTE_REQUIRE_SUPABASE_ACCESS_TOKEN === 'true';
let projectUrl;

class CheckFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckFailedError';
  }
}

try {
  await main();
} catch (error) {
  fail(errorMessage(error));
}

async function main() {
  if (!supabaseUrl) {
    throw new CheckFailedError('VITE_SUPABASE_URL is missing. Add it to .env.local.');
  }
  if (!publishableKey) {
    throw new CheckFailedError('VITE_SUPABASE_PUBLISHABLE_KEY is missing. Add it to .env.local.');
  }

  try {
    projectUrl = new URL(supabaseUrl);
  } catch (error) {
    throw new CheckFailedError(`VITE_SUPABASE_URL is invalid: ${errorMessage(error)}`);
  }

  console.log(`Checking Supabase sync backend at ${redactProjectUrl(projectUrl)}`);

  try {
    await lookup(projectUrl.hostname);
    console.log('Project DNS: ok');
  } catch (error) {
    throw new CheckFailedError(
      [
        `Could not resolve Supabase project hostname: ${projectUrl.hostname}`,
        `DNS error: ${errorMessage(error)}`,
        'Check that VITE_SUPABASE_URL points to an existing, active Supabase project.',
      ].join('\n'),
    );
  }

  await checkHealth();
  await checkTables('anonymous publishable key', publishableKey, { anonymous: true });

  const authenticatedToken = accessToken || (oauthLogin ? await getOAuthAccessToken() : '');

  if (authenticatedToken) {
    await checkTables('signed-in access token', authenticatedToken, { anonymous: false });
    await checkSyncTableWrites(authenticatedToken, jwtSubject(authenticatedToken));
    await checkStorage(authenticatedToken, jwtSubject(authenticatedToken));
  } else if (requireAuthenticatedCheck) {
    throw new CheckFailedError(
      [
        'Signed-in table and Storage checks are required, but SUPABASE_ACCESS_TOKEN is missing.',
        'Run npm run check:supabase-sync:oauth to sign in through the browser, sign in to MarkNote and run Diagnose sync in the app, or set SUPABASE_ACCESS_TOKEN to a fresh signed-in access token and rerun this command.',
      ].join('\n'),
    );
  } else {
    console.log(
      [
        'Signed-in table check: skipped. Set SUPABASE_ACCESS_TOKEN locally to verify authenticated Data API and Storage access.',
        'For release verification, rerun with --oauth-login, use npm run check:supabase-sync:oauth, or use npm run check:supabase-sync:auth so skipped signed-in checks fail the command.',
        'You can also sign in inside MarkNote and click Diagnose sync to run the same signed-in table and Storage canaries with the current app session.',
      ].join('\n'),
    );
  }
}

async function getOAuthAccessToken() {
  const provider = env.MARKNOTE_SUPABASE_OAUTH_PROVIDER || 'google';
  const callback = await createLoopbackCallbackServer();
  try {
    const client = createOAuthClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callback.redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error) {
      throw new CheckFailedError(`Could not start ${provider} OAuth login: ${error.message}`);
    }
    if (!data.url) {
      throw new CheckFailedError(`Could not start ${provider} OAuth login: Supabase did not return an authorization URL.`);
    }

    console.log(`OAuth login: open this URL and finish ${provider} sign-in:`);
    console.log(data.url);
    console.log(`Waiting for OAuth callback on ${callback.redirectTo}`);
    maybeOpenOAuthUrl(data.url);

    const callbackUrl = await callback.waitForCallback();
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (oauthError) {
      throw new CheckFailedError(`OAuth login failed: ${oauthError}`);
    }
    if (!code) {
      throw new CheckFailedError('OAuth login callback did not include an authorization code.');
    }

    const { data: sessionData, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      throw new CheckFailedError(`OAuth login code exchange failed: ${exchangeError.message}`);
    }
    const token = sessionData.session?.access_token;
    if (!token) {
      throw new CheckFailedError('OAuth login succeeded, but Supabase did not return an access token.');
    }
    console.log(`OAuth login: signed in as ${sessionData.session.user.email || sessionData.session.user.id}.`);
    return token;
  } finally {
    await callback.close();
  }
}

function createOAuthClient() {
  const memoryStorage = new Map();
  return {
    auth: new GoTrueClient({
      url: new URL('/auth/v1', supabaseUrl).toString().replace(/\/$/, ''),
      headers: {
        apikey: publishableKey,
      },
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      storageKey: 'marknote-sync-check-auth',
      storage: {
        getItem: (key) => memoryStorage.get(key) ?? null,
        setItem: (key, value) => {
          memoryStorage.set(key, value);
        },
        removeItem: (key) => {
          memoryStorage.delete(key);
        },
      },
    }),
  };
}

async function createLoopbackCallbackServer() {
  if (env.MARKNOTE_SUPABASE_OAUTH_TEST_CALLBACK_URL) {
    return {
      redirectTo: env.MARKNOTE_SUPABASE_OAUTH_TEST_CALLBACK_URL,
      waitForCallback: async () => {
        const response = await fetch(env.MARKNOTE_SUPABASE_OAUTH_TEST_CALLBACK_URL);
        const text = await response.text().catch(() => '');
        return text || env.MARKNOTE_SUPABASE_OAUTH_TEST_CALLBACK_URL;
      },
      close: async () => undefined,
    };
  }

  const timeoutMs = Number(env.MARKNOTE_SUPABASE_OAUTH_TIMEOUT_MS || 180000);
  let resolveCallback;
  let rejectCallback;
  let redirectTo = 'http://127.0.0.1/auth/callback';
  const callbackPromise = new Promise((resolveCallbackUrl, rejectCallbackUrl) => {
    resolveCallback = resolveCallbackUrl;
    rejectCallback = rejectCallbackUrl;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', redirectTo);
    if (requestUrl.pathname !== '/auth/callback') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>MarkNote sync check</title><p>MarkNote sync check received the OAuth callback. You can close this tab.</p>');
    resolveCallback(requestUrl.toString());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new CheckFailedError('Could not start local OAuth callback server.');
  }
  redirectTo = `http://127.0.0.1:${address.port}/auth/callback`;
  const timer = setTimeout(() => {
    rejectCallback(new CheckFailedError(`OAuth login timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
  }, timeoutMs);
  timer.unref?.();

  return {
    redirectTo,
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise((resolveClose) => {
        clearTimeout(timer);
        server.close(() => resolveClose());
      }),
  };
}

function maybeOpenOAuthUrl(url) {
  if (env.MARKNOTE_SUPABASE_OAUTH_OPEN === '0' || env.CI) {
    return;
  }

  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  try {
    const child = spawn(command.file, command.args, {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The URL is already printed, so failing to auto-open a browser is non-fatal.
  }
}

async function checkHealth() {
  const healthUrl = new URL('/auth/v1/health', projectUrl);
  let response;
  try {
    response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        apikey: publishableKey,
      },
    });
  } catch (error) {
    throw new CheckFailedError(`Could not reach Supabase Auth health endpoint. ${supabaseProjectReachabilityMessage(error)}`);
  }
  if (response.status >= 500) {
    const body = await response.text().catch(() => '');
    throw new CheckFailedError(`Supabase Auth health check failed: HTTP ${response.status}${body ? ` ${body.slice(0, 240)}` : ''}`);
  }
  console.log(`Auth health: HTTP ${response.status}`);
}

async function checkTables(label, bearerToken, options) {
  console.log(`Table probe (${label}):`);
  const failures = [];
  for (const table of TABLES) {
    const result = await probeTable(table, bearerToken);
    const detail = [result.status, result.code, result.message].filter(Boolean).join(' ');
    if (options.anonymous) {
      if (result.status === 200) {
        console.log(`  ${table}: reachable anonymously (RLS may still hide rows).`);
      } else {
        console.log(`  ${table}: ${detail} (expected for login-only sync).`);
      }
      continue;
    }
    if (result.status === 200) {
      console.log(`  ${table}: ok`);
      continue;
    }
    failures.push(result);
    console.log(`  ${table}: ${detail}`);
  }
  if (failures.length) {
    throw new CheckFailedError(authenticatedTableFailureMessage(failures));
  }
}

function authenticatedTableFailureMessage(results) {
  if (results.some((result) => result.status === 401 || /jwt|token/i.test(result.message || ''))) {
    return [
      'Authenticated sync table check failed because SUPABASE_ACCESS_TOKEN was rejected.',
      'Sign in again, copy a fresh access token, and rerun this check.',
    ].join('\n');
  }
  if (results.some((result) => result.code === 'PGRST205')) {
    return [
      'Authenticated sync table check failed because a sync table is missing from the Supabase Data API schema cache.',
      'Apply supabase/migrations/202606190001_marknote_sync_schema.sql, confirm the authenticated GRANT statements are present, then reload the PostgREST schema cache.',
      'Run npm run check:supabase-migration with SUPABASE_MANAGEMENT_TOKEN to inspect readiness, then run npm run apply:supabase-migration or paste npm run print:supabase-migration output into Supabase SQL Editor. After that, rerun npm run verify:release:online:manual.',
    ].join('\n');
  }
  if (results.some((result) => result.code === '42501' || /permission denied/i.test(result.message || ''))) {
    return [
      'Authenticated sync table check failed because the signed-in role lacks required Data API privileges.',
      'Confirm the authenticated GRANT statements and RLS policies from supabase/migrations/202606190001_marknote_sync_schema.sql are applied.',
    ].join('\n');
  }
  return [
    'Authenticated sync table check failed.',
    'Apply supabase/migrations/202606190001_marknote_sync_schema.sql and confirm the authenticated GRANT + RLS policies are present.',
  ].join('\n');
}

async function checkSyncTableWrites(bearerToken, userId) {
  if (!userId) {
    throw new CheckFailedError('SUPABASE_ACCESS_TOKEN is not a valid JWT with a sub claim. Sign in again and retry the backend check.');
  }
  const now = new Date().toISOString();
  const suffix = `${Date.now()}`;
  const folderId = `marknote-diagnostic-folder-${suffix}`;
  const noteId = `marknote-diagnostic-note-${suffix}`;
  const attachmentId = `marknote-diagnostic-attachment-${suffix}`;
  const storagePath = `${userId}/.marknote-diagnostics/${attachmentId}.txt`;
  const cleanup = async () => {
    const attachmentDelete = await deleteRows('attachments', bearerToken, userId, attachmentId);
    const noteDelete = await deleteRows('notes', bearerToken, userId, noteId);
    const folderDelete = await deleteRows('folders', bearerToken, userId, folderId);
    return [
      { label: 'Sync table attachment delete', response: attachmentDelete },
      { label: 'Sync table note delete', response: noteDelete },
      { label: 'Sync table folder delete', response: folderDelete },
    ];
  };

  try {
    const folderInsert = await tableRequest('folders', bearerToken, {
      method: 'POST',
      body: {
        id: folderId,
        user_id: userId,
        name: 'MarkNote diagnostic folder',
        sort_order: 0,
        created_at: now,
        updated_at: now,
        version: 1,
      },
    });
    if (!folderInsert.ok) {
      throw tableWriteError('Sync table folder insert', folderInsert);
    }

    const noteInsert = await tableRequest('notes', bearerToken, {
      method: 'POST',
      body: {
        id: noteId,
        user_id: userId,
        folder_id: folderId,
        title: 'MarkNote diagnostic note',
        content: '<p>diagnostic</p>',
        raw_content: 'diagnostic',
        tags: [],
        pinned: false,
        created_at: now,
        updated_at: now,
        version: 1,
      },
    });
    if (!noteInsert.ok) {
      throw tableWriteError('Sync table note insert', noteInsert);
    }

    const attachmentInsert = await tableRequest('attachments', bearerToken, {
      method: 'POST',
      body: {
        id: attachmentId,
        user_id: userId,
        note_id: noteId,
        storage_path: storagePath,
        mime_type: 'text/plain',
        size_bytes: 0,
        created_at: now,
        updated_at: now,
      },
    });
    if (!attachmentInsert.ok) {
      throw tableWriteError('Sync table attachment insert', attachmentInsert);
    }

    const noteUpdate = await tableRequest('notes', bearerToken, {
      method: 'PATCH',
      query: { user_id: `eq.${userId}`, id: `eq.${noteId}` },
      body: {
        title: 'MarkNote diagnostic note updated',
        updated_at: new Date().toISOString(),
      },
    });
    if (!noteUpdate.ok) {
      throw tableWriteError('Sync table note update', noteUpdate);
    }

    const cleanupResults = await cleanup();
    const cleanupFailure = cleanupResults.find((result) => !result.response.ok);
    if (cleanupFailure) {
      throw tableWriteError(cleanupFailure.label, cleanupFailure.response);
    }
    const leftover = await findDiagnosticRowLeftover(bearerToken, userId, [
      { table: 'attachments', id: attachmentId, label: 'Sync table attachment delete' },
      { table: 'notes', id: noteId, label: 'Sync table note delete' },
      { table: 'folders', id: folderId, label: 'Sync table folder delete' },
    ]);
    if (leftover) {
      throw new CheckFailedError(`${leftover.label} returned success, but the diagnostic row is still visible.`);
    }
    console.log('Sync table writes: ok (insert, update, delete)');
  } finally {
    await cleanup().catch(() => undefined);
  }
}

async function deleteRows(table, bearerToken, userId, id) {
  return tableRequest(table, bearerToken, {
    method: 'DELETE',
    query: { user_id: `eq.${userId}`, id: `eq.${id}` },
  });
}

async function findDiagnosticRowLeftover(bearerToken, userId, rows) {
  for (const row of rows) {
    const result = await tableRequest(row.table, bearerToken, {
      method: 'GET',
      query: {
        select: 'id',
        user_id: `eq.${userId}`,
        id: `eq.${row.id}`,
        limit: '1',
      },
    });
    if (!result.ok || (Array.isArray(result.body) && result.body.length > 0)) {
      return row;
    }
  }
  return null;
}

async function tableRequest(table, bearerToken, { method, body, query = {} }) {
  const url = new URL(`/rest/v1/${table}`, projectUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  let response;
  let text = '';
  try {
    response = await fetch(url, {
      method,
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${bearerToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    text = await response.text();
  } catch (error) {
    return {
      ok: false,
      status: 'FETCH_ERROR',
      body: { message: errorMessage(error) },
    };
  }
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    body: parseBody(text),
  };
}

function tableWriteError(label, response) {
  return new CheckFailedError(
    [
      `${label} check failed: HTTP ${response.status}`,
      response.body.code ? `Code: ${response.body.code}` : '',
      response.body.message ? `Message: ${response.body.message}` : '',
      'Confirm the authenticated Data API grants, RLS policies, and folder/note/attachment foreign keys from the sync migration are applied.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function checkStorage(bearerToken, userId) {
  if (!userId) {
    throw new CheckFailedError('SUPABASE_ACCESS_TOKEN is not a valid JWT with a sub claim. Sign in again and retry the backend check.');
  }
  await checkStorageList(bearerToken, userId);
  await checkStorageCanary(bearerToken, userId);
}

async function checkStorageList(bearerToken, userId) {
  const response = await storageRequest({
    method: 'POST',
    path: '/storage/v1/object/list/attachments',
    bearerToken,
    body: JSON.stringify({ limit: 1, prefix: userId }),
  });
  if (response.ok) {
    console.log(`Attachments bucket list: ok (${userId}/ prefix)`);
    return;
  }
  throw storageError('Attachments bucket list', response);
}

async function checkStorageCanary(bearerToken, userId) {
  const canaryPath = `${userId}/.marknote-diagnostics/check-supabase-sync-${Date.now()}.txt`;
  let shouldCleanup = false;
  try {
    const upload = await storageRequest({
      method: 'POST',
      path: `/storage/v1/object/attachments/${encodeStoragePath(canaryPath)}`,
      bearerToken,
      contentType: 'text/plain',
      headers: {
        'x-upsert': 'false',
      },
      body: 'marknote storage diagnostic v1',
    });
    if (!upload.ok) {
      throw storageError('Attachment storage upload', upload);
    }
    shouldCleanup = true;

    const overwrite = await storageRequest({
      method: 'POST',
      path: `/storage/v1/object/attachments/${encodeStoragePath(canaryPath)}`,
      bearerToken,
      contentType: 'text/plain',
      headers: {
        'x-upsert': 'true',
      },
      body: 'marknote storage diagnostic v2',
    });
    if (!overwrite.ok) {
      throw storageError('Attachment storage overwrite', overwrite);
    }

    const download = await storageRequest({
      method: 'GET',
      path: `/storage/v1/object/authenticated/attachments/${encodeStoragePath(canaryPath)}`,
      bearerToken,
    });
    if (!download.ok) {
      throw storageError('Attachment storage download', download);
    }

    const remove = await deleteStorageObject(bearerToken, canaryPath);
    if (!remove.ok) {
      throw storageError('Attachment storage delete', remove);
    }

    const deletedDownload = await storageRequest({
      method: 'GET',
      path: `/storage/v1/object/authenticated/attachments/${encodeStoragePath(canaryPath)}`,
      bearerToken,
    });
    if (deletedDownload.status === 'FETCH_ERROR') {
      throw storageError('Attachment storage delete verification', deletedDownload);
    }
    if (deletedDownload.ok) {
      throw new CheckFailedError('Attachment storage delete returned success, but the diagnostic object is still downloadable.');
    }

    shouldCleanup = false;
    console.log('Attachment storage canary: ok (upload, overwrite, download, delete)');
  } finally {
    if (shouldCleanup) {
      await deleteStorageObject(bearerToken, canaryPath).catch(() => undefined);
    }
  }
}

async function deleteStorageObject(bearerToken, objectPath) {
  return storageRequest({
    method: 'DELETE',
    path: '/storage/v1/object/attachments',
    bearerToken,
    body: JSON.stringify({ prefixes: [objectPath] }),
  });
}

async function storageRequest({ method, path, bearerToken, body, contentType = 'application/json', headers = {} }) {
  const url = new URL(path, projectUrl);
  let response;
  let text = '';
  try {
    response = await fetch(url, {
      method,
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${bearerToken}`,
        ...(body === undefined ? {} : { 'content-type': contentType }),
        ...headers,
      },
      body,
    });
    text = await response.text();
  } catch (error) {
    return {
      ok: false,
      status: 'FETCH_ERROR',
      body: { message: errorMessage(error) },
    };
  }
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    body: parseBody(text),
  };
}

function storageError(label, response) {
  return new CheckFailedError(
    [
      `${label} check failed: HTTP ${response.status}`,
      response.body.code ? `Code: ${response.body.code}` : '',
      response.body.message ? `Message: ${response.body.message}` : '',
      'Confirm the attachments bucket exists and authenticated storage.objects policies allow SELECT, INSERT, UPDATE, and DELETE for the user prefix.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function encodeStoragePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

async function probeTable(table, bearerToken) {
  const url = new URL(`/rest/v1/${table}`, projectUrl);
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '1');
  try {
    const response = await fetch(url, {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${bearerToken}`,
      },
    });
    const body = parseBody(await response.text());
    return {
      status: response.status,
      code: body.code,
      message: body.message,
    };
  } catch (error) {
    return {
      status: 'FETCH_ERROR',
      message: errorMessage(error),
    };
  }
}

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(resolve(path), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const [key, ...valueParts] = line.split('=');
          return [key, valueParts.join('=').replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

function parseBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return { message: body.slice(0, 240) };
  }
}

function jwtSubject(token) {
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof decoded.sub === 'string' ? decoded.sub : '';
  } catch {
    return '';
  }
}

function errorMessage(error) {
  return errorWithCauseMessage(error);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function redactProjectUrl(url) {
  const clone = new URL(url);
  clone.hostname = clone.hostname.replace(/^([^.]{6})[^.]*/, '$1...');
  return clone.toString();
}
