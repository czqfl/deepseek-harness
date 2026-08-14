/**
 * Offline electron bootstrap: extract the cached electron zip into the
 * electron package's dist/ when a normal `pnpm install` cannot download it
 * (this machine's npm registry is a local mirror and GitHub is unreachable).
 *
 * The cache is the standard @electron/get location
 * (%LOCALAPPDATA%/electron/Cache/<sha>/electron-v<version>-win32-x64.zip);
 * electron's own postinstall skips the download when
 * ELECTRON_SKIP_BINARY_DOWNLOAD=1 is set, so installs complete and this script
 * supplies the binary afterwards.
 * @module @deepseek-ai/dsh-desktop/ensure-electron
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const VERSION = '28.3.3'
const CACHE_ROOT = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'electron', 'Cache')
const PKG_DIR = join(process.cwd(), 'node_modules', '.pnpm', `electron@${VERSION}`, 'node_modules', 'electron')

function findCachedZip() {
  for (const entry of readdirSync(CACHE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const zip = join(CACHE_ROOT, entry.name, `electron-v${VERSION}-win32-x64.zip`)
    if (existsSync(zip)) return zip
  }
  return undefined
}

function extract(zip, dist) {
  // PowerShell Expand-Archive handles the zip without extra dependencies.
  mkdirSync(dist, { recursive: true })
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${dist}' -Force`], { stdio: 'inherit' })
  writeFileSync(join(dirname(dist), 'path.txt'), 'electron.exe')
}

const dist = join(PKG_DIR, 'dist')
if (existsSync(join(dist, 'electron.exe'))) {
  console.log(`electron ${VERSION} already extracted at ${dist}`)
} else {
  const zip = findCachedZip()
  if (zip === undefined) {
    throw new Error(`no cached electron-v${VERSION}-win32-x64.zip under ${CACHE_ROOT}`)
  }
  rmSync(dist, { recursive: true, force: true })
  extract(zip, dist)
  console.log(`electron ${VERSION} extracted from ${zip} -> ${dist}`)
}
