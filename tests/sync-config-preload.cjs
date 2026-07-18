const endpoint = process.env.MARKNOTE_SYNC_CONFIG_URL;
const payload = JSON.parse(
  process.env.MARKNOTE_TEST_SYNC_CONFIG_JSON ||
    JSON.stringify({
      provider: 'supabase',
      supabase: {
        url: 'https://localhost',
        publishableKey: 'sb_publishable_test',
      },
    }),
);
const previousFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  if (endpoint && String(input) === endpoint) {
    return {
      ok: true,
      status: 200,
      headers: { get() { return 'application/json'; } },
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  }
  return previousFetch(input, init);
};
