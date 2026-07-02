/* global console, fetch, process, URL */

import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
  ...process.env,
};

const supabaseUrl = env.VITE_SUPABASE_URL;
const redirectTo = env.VITE_SUPABASE_AUTH_REDIRECT_URL || 'http://127.0.0.1:5173/?app=1';

if (!supabaseUrl) {
  fail('VITE_SUPABASE_URL is missing. Add it to .env.local.');
}

let authorizeUrl;
try {
  authorizeUrl = new URL('/auth/v1/authorize', supabaseUrl);
  authorizeUrl.searchParams.set('provider', 'google');
  authorizeUrl.searchParams.set('redirect_to', redirectTo);
} catch (error) {
  fail(`VITE_SUPABASE_URL is invalid: ${errorMessage(error)}`);
}

console.log(`Checking Google OAuth at ${redactProjectUrl(authorizeUrl)}`);
console.log(`Redirect URL: ${redirectTo}`);
console.log(`Google Cloud authorized redirect URI: ${supabaseCallbackUrl(authorizeUrl)}`);

try {
  await lookup(authorizeUrl.hostname);
} catch (error) {
  fail(
    [
      `Could not resolve Supabase project hostname: ${authorizeUrl.hostname}`,
      `DNS error: ${errorMessage(error)}`,
      'Check that VITE_SUPABASE_URL points to an existing, active Supabase project.',
    ].join('\n'),
  );
}

let response;
try {
  response = await fetch(authorizeUrl, {
    method: 'GET',
    redirect: 'manual',
  });
} catch (error) {
  fail(`Could not reach Supabase Auth endpoint: ${errorMessage(error)}`);
}

const location = response.headers.get('location') || '';
if (response.status >= 300 && response.status < 400 && /accounts\.google\.com|google/i.test(location)) {
  await assertGoogleAcceptsOAuthUrl(location);
  console.log('Google OAuth provider is reachable and Google accepted the configured OAuth client.');
  process.exit(0);
}

const body = await response.text().catch(() => '');
fail(
  [
    `Unexpected Supabase Auth response: HTTP ${response.status}`,
    location ? `Location: ${location}` : '',
    body ? `Body: ${body.slice(0, 500)}` : '',
    'Check that the Google provider is enabled and that the redirect URL is allowed in Supabase Auth URL Configuration.',
    'For the packaged desktop app, also allow marknote://auth/callback.',
  ]
    .filter(Boolean)
    .join('\n'),
);

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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function assertGoogleAcceptsOAuthUrl(location) {
  let googleUrl;
  try {
    googleUrl = new URL(location);
  } catch (error) {
    fail(`Supabase returned an invalid Google OAuth redirect URL: ${errorMessage(error)}`);
  }

  let googleResponse;
  try {
    googleResponse = await fetch(googleUrl, {
      method: 'GET',
      redirect: 'manual',
    });
  } catch (error) {
    fail(`Could not reach Google OAuth endpoint: ${errorMessage(error)}`);
  }

  const nextLocation = googleResponse.headers.get('location') || '';
  if (/\/signin\/oauth\/error/i.test(nextLocation)) {
    await failWithGoogleOAuthError(nextLocation);
  }

  if (googleResponse.status >= 200 && googleResponse.status < 400) {
    return;
  }

  const body = await googleResponse.text().catch(() => '');
  fail(
    [
      `Unexpected Google OAuth response: HTTP ${googleResponse.status}`,
      body ? `Body: ${body.slice(0, 500)}` : '',
      'Check the Google OAuth Client ID and Client Secret configured in Supabase Auth > Providers > Google.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function failWithGoogleOAuthError(errorUrl) {
  let response;
  try {
    response = await fetch(errorUrl, {
      method: 'GET',
      redirect: 'follow',
    });
  } catch (error) {
    fail(`Google OAuth rejected the configured client: ${errorMessage(error)}`);
  }

  const body = await response.text().catch(() => '');
  const compactBody = body.replace(/\s+/g, ' ');
  const invalidClient = /invalid_client|OAuth client was not found/i.test(compactBody);
  const summary = googleOAuthErrorSummary(compactBody);
  fail(
    [
      invalidClient
        ? 'Google OAuth rejected the configured client: invalid_client.'
        : 'Google OAuth rejected the configured client.',
      summary ? `Google response: ${summary}` : '',
      'Fix the Google OAuth Client ID and Client Secret in Supabase Auth > Providers > Google.',
      `In Google Cloud, the OAuth client must be a Web application and must allow ${supabaseCallbackUrl(authorizeUrl)} as an authorized redirect URI.`,
      'Then rerun this check.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function googleOAuthErrorSummary(body) {
  const pieces = [
    body.match(/Access blocked:[^<]+/i)?.[0],
    body.match(/The OAuth client was not found\./i)?.[0],
    body.match(/Error\s+\d+:\s+[a-z_]+/i)?.[0],
  ].filter(Boolean);
  return [...new Set(pieces)].join(' ');
}

function redactProjectUrl(url) {
  const clone = new URL(url);
  clone.hostname = clone.hostname.replace(/^([^.]{6})[^.]*/, '$1...');
  return clone.toString();
}

function supabaseCallbackUrl(url) {
  return new URL('/auth/v1/callback', url.origin).toString();
}
