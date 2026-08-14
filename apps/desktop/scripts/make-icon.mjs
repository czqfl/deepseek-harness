/**
 * Generate the desktop app icon (build/icon.png, 512×512) from the Web GUI's
 * favicon: a dark rounded tile with the harness glyph in white.
 *
 * Run with `pnpm --filter @deepseek-ai/dsh-desktop run icon` (i.e. through
 * Electron, so no extra renderer is needed).
 * @module @deepseek-ai/dsh-desktop/make-icon
 */

import { app, BrowserWindow, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(MODULE_DIR, '..')
const REPO_ROOT = resolve(APP_DIR, '..', '..')
const FAVICON = readFileSync(join(REPO_ROOT, 'apps', 'web', 'public', 'favicon.svg'), 'utf8')
const SIZE = 512

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; background: #0b0e14; }
  .tile { position: absolute; inset: 0; margin: auto; width: 76%; height: 76%;
          background: linear-gradient(160deg, #1c2333, #10141d); border-radius: 22%; }
  .glyph { position: absolute; inset: 0; margin: auto; width: 62%; height: 62%; }
</style></head><body>
  <div class="tile"></div>
  <img class="glyph" alt="" src="data:image/svg+xml;base64,${Buffer.from(FAVICON).toString('base64')}">
</body></html>`

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    webPreferences: { offscreen: false },
  })
  await win.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`)
  const image = await win.webContents.capturePage()
  const out = join(APP_DIR, 'build', 'icon.png')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, image.toPNG())
  console.log(`desktop icon written: ${out}`)
  app.quit()
})
