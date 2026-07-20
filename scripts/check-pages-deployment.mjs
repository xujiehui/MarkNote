import { pathToFileURL } from 'node:url';

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const forbiddenKeyPatterns = [
  /sb_publishable_[A-Za-z0-9_-]{16,}/,
  /sb_secret_[A-Za-z0-9_-]{16,}/,
];

export async function checkPagesDeployment({
  pagesUrl,
  syncConfigUrl,
  fetchImpl = fetch,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  log = console.log,
} = {}) {
  const workspaceUrl = requiredUrl(pagesUrl, 'MARKNOTE_PAGES_URL');
  const configUrl = requiredUrl(syncConfigUrl, 'VITE_SYNC_CONFIG_URL');
  if (workspaceUrl.searchParams.get('app') !== '1') {
    throw new Error('MARKNOTE_PAGES_URL must open the workspace with ?app=1.');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await checkDeploymentOnce({ workspaceUrl, configUrl, fetchImpl });
      log(`Pages cloud sync deployment: ok (${workspaceUrl.origin}${workspaceUrl.pathname})`);
      log(`Verified deployed endpoint, CORS, runtime payload, and Google Auth provider (${result.bundleUrl.pathname}).`);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      log(`Pages deployment check attempt ${attempt}/${attempts} is not ready: ${errorMessage(error)}`);
      await delay(retryDelayMs);
    }
  }
  throw lastError;
}

async function checkDeploymentOnce({ workspaceUrl, configUrl, fetchImpl }) {
  const html = await fetchText(fetchImpl, workspaceUrl, {
    headers: {
      accept: 'text/html',
      'cache-control': 'no-cache',
    },
    cache: 'no-store',
  });
  const bundlePath = rendererBundlePath(html);
  const bundleUrl = new URL(bundlePath, workspaceUrl);
  const bundle = await fetchText(fetchImpl, bundleUrl, {
    headers: {
      accept: 'text/javascript',
      'cache-control': 'no-cache',
    },
    cache: 'no-store',
  });

  if (!bundle.includes(configUrl.toString())) {
    throw new Error('Deployed Pages bundle does not contain the configured sync backend endpoint.');
  }
  if (forbiddenKeyPatterns.some((pattern) => pattern.test(bundle))) {
    throw new Error('Deployed Pages bundle contains an embedded Supabase key.');
  }

  const configResponse = await fetchResponse(fetchImpl, configUrl, {
    headers: {
      accept: 'application/json',
      origin: workspaceUrl.origin,
    },
    cache: 'no-store',
  });
  const allowOrigin = configResponse.headers.get('access-control-allow-origin') || '';
  if (allowOrigin !== '*' && allowOrigin !== workspaceUrl.origin) {
    throw new Error(`Sync backend CORS does not allow the Pages origin (${workspaceUrl.origin}).`);
  }

  const payload = await configResponse.json().catch((error) => {
    throw new Error(`Sync backend returned invalid JSON: ${errorMessage(error)}`);
  });
  const runtimeConfig = normalizeRuntimeConfig(payload);
  const authSettingsUrl = new URL('/auth/v1/settings', runtimeConfig.url);
  const settingsResponse = await fetchResponse(fetchImpl, authSettingsUrl, {
    headers: {
      apikey: runtimeConfig.publishableKey,
    },
    cache: 'no-store',
  });
  const settings = await settingsResponse.json().catch((error) => {
    throw new Error(`Supabase Auth settings returned invalid JSON: ${errorMessage(error)}`);
  });
  if (!settings?.external?.google) {
    throw new Error('Supabase Google Auth provider is not enabled.');
  }

  return {
    bundleUrl,
    configUrl,
    supabaseUrl: new URL(runtimeConfig.url),
  };
}

async function fetchText(fetchImpl, url, init) {
  return (await fetchResponse(fetchImpl, url, init)).text();
}

async function fetchResponse(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new Error(`Could not fetch ${redactUrl(url)}: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Could not fetch ${redactUrl(url)}: HTTP ${response.status}`);
  }
  return response;
}

function rendererBundlePath(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
  const bundle = scripts.find((source) => /(?:^|\/)assets\/index-[^/]+\.js(?:\?.*)?$/i.test(source));
  if (!bundle) {
    throw new Error('Could not find the deployed renderer bundle in the Pages HTML.');
  }
  return bundle;
}

function normalizeRuntimeConfig(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Sync backend returned an invalid payload.');
  }
  if (payload.provider !== 'supabase') {
    throw new Error('Sync backend is not configured for Supabase.');
  }
  const supabase = payload.supabase;
  if (!supabase || typeof supabase !== 'object' || Array.isArray(supabase)) {
    throw new Error('Sync backend payload is missing Supabase configuration.');
  }
  if ('secretKey' in supabase || 'serviceRoleKey' in supabase) {
    throw new Error('Sync backend payload exposes a secret or service-role key.');
  }
  if (typeof supabase.url !== 'string' || typeof supabase.publishableKey !== 'string') {
    throw new Error('Sync backend payload must contain Supabase url and publishableKey.');
  }
  requiredUrl(supabase.url, 'Supabase URL');
  if (!supabase.publishableKey.trim()) {
    throw new Error('Sync backend publishableKey is empty.');
  }
  return {
    url: supabase.url,
    publishableKey: supabase.publishableKey,
  };
}

function requiredUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS.`);
  }
  return url;
}

function redactUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  await checkPagesDeployment({
    pagesUrl: process.env.MARKNOTE_PAGES_URL,
    syncConfigUrl: process.env.MARKNOTE_SYNC_CONFIG_URL || process.env.VITE_SYNC_CONFIG_URL,
    attempts: numberValue(process.env.MARKNOTE_PAGES_CHECK_ATTEMPTS, DEFAULT_ATTEMPTS),
    retryDelayMs: numberValue(process.env.MARKNOTE_PAGES_CHECK_RETRY_MS, DEFAULT_RETRY_DELAY_MS),
  });
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
