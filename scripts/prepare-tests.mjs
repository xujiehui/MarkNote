import { rmSync } from 'node:fs';
// Generated test output must not execute stale suites removed from source.
rmSync('.tmp-tests', { recursive: true, force: true });
