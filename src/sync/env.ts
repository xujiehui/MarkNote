export function readSyncEnv(name: string): string | undefined {
  return globalThis.__MARKNOTE_ENV__?.[name];
}
