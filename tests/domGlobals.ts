export function installDomGlobals(globals: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
}
