/**
 * Electron type stub. playwright-core's public types import 'electron' for its
 * Electron browser support; resolving the real `electron.d.ts` leaks Electron's
 * global `Process` interface (whose `off` takes only `'loaded'`) into every
 * aggregate program and shadows Node's `process`. No repository code drives
 * Electron through playwright, so the stub keeps the import satisfied without
 * loading Electron's globals. Wired via tsconfig.base.json `paths`.
 */
declare module 'electron' {
  // Referenced only at the type level by playwright-core's Electron support.
  export type BrowserWindow = unknown
  export type App = unknown
}
