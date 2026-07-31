import { createRequire } from 'node:module';

// package.json sits outside rootDir, so it can't be imported — and it's two
// levels up from both src/core/ (dev) and dist/core/ (the deployed tree).
export function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
