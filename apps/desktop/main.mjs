/**
 * DeepSeek Harness Desktop — Electron shell over the local `dsh web` server.
 *
 * The shell owns the server's lifecycle: it spawns `dsh web` as a child
 * process (default port 0, so the OS assigns a free one), waits for the
 * readiness line (`dsh web: http://127.0.0.1:<port>`) the web bundle prints
 * once the Loader tree settles, opens that URL in an app window, and
 * terminates the child when the window closes.
 *
 * Runtime resolution:
 * - Unpackaged (`pnpm start`): spawns the workspace's built CLI
 *   (`apps/cli/lib/bin.js`) with the system Node (found via
 *   `DSH_DESKTOP_NODE`, `npm_node_execpath`, or PATH) and cwd = repo root.
 * - Packaged (electron-builder): spawns the bundled dsh payload
 *   (`resources/dsh`) with the bundled Node (`resources/node/node.exe`) and
 *   cwd = the payload root.
 *
 * `--smoke` runs a headless self-check: start the server, load the GUI, assert
 * `window.__DSH_BOOT__` was injected, print `DESKTOP_SMOKE_OK <url>`, and exit.
 * @module @deepseek-ai/dsh-desktop
 */

import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
/** Workspace root when running unpackaged (`apps/desktop/../..`). */
const REPO_ROOT = resolve(MODULE_DIR, '..', '..')
const APP_NAME = 'DeepSeek Harness'
const SMOKE = process.argv.includes('--smoke')

/** Readiness signal: the web bundle prints the canonical URL once its tree settles. */
const URL_LINE = /dsh web: (http:\/\/\S+)/

let mainWindow
let serverChild

function log(message) {
  const line = `[desktop] ${message}`
  console.log(line)
  try {
    const file = join(app.getPath('userData'), 'desktop.log')
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // logging must never take the shell down
  }
}

/** The Node executable used to run the dsh CLI. */
function resolveNodeExe() {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'node', 'node.exe')
    if (existsSync(bundled)) return bundled
    log('packaged run without bundled node.exe; falling back to system node')
  }
  if (process.env.DSH_DESKTOP_NODE) return process.env.DSH_DESKTOP_NODE
  if (process.env.npm_node_execpath) return process.env.npm_node_execpath
  return 'node.exe'
}

/**
 * The dsh CLI entry. Packaged runs use the bundled payload; unpackaged runs
 * prefer the built `apps/cli/lib/bin.js` and fall back to the tsx source
 * launch (`node --import tsx/esm apps/cli/src/bin.ts`) used by `pnpm dsh`.
 * @returns `{ entry, sourceLaunch }` — the entry path and whether tsx is needed.
 */
function resolveServerEntry() {
  if (app.isPackaged) return { entry: join(process.resourcesPath, 'dsh', 'lib', 'bin.js'), sourceLaunch: false }
  const built = join(REPO_ROOT, 'apps', 'cli', 'lib', 'bin.js')
  if (existsSync(built)) return { entry: built, sourceLaunch: false }
  return { entry: join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts'), sourceLaunch: true }
}

/** Listen port: `DSH_DESKTOP_PORT` pins it; the default 0 lets the OS pick a free one. */
function resolvePort() {
  const raw = process.env.DSH_DESKTOP_PORT
  if (raw !== undefined && /^\d+$/.test(raw)) return Number(raw)
  return 0
}

/** Spawn the dsh web server and resolve with `{ child, url }` on the readiness line. */
function startServer() {
  const port = resolvePort()
  const { entry, sourceLaunch } = resolveServerEntry()
  const nodeExe = resolveNodeExe()
  const args = [
    ...(sourceLaunch ? ['--import', 'tsx/esm'] : []),
    entry,
    'web',
    '--host', '127.0.0.1',
    '--port', String(port),
  ]
  const cwd = app.isPackaged ? join(process.resourcesPath, 'dsh') : REPO_ROOT
  log(`spawning: ${nodeExe} ${args.join(' ')} (cwd: ${cwd})`)
  const child = spawn(nodeExe, args, { cwd, env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`server did not print its URL within ${String(STARTUP_TIMEOUT_MS / 1000)}s`))
      void stopServer(child)
    }, STARTUP_TIMEOUT_MS)
    const settle = (fn) => (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    child.stdout.on('data', (chunk) => {
      const match = URL_LINE.exec(String(chunk))
      if (match) settle((url) => resolve({ child, url: match[1] }))(match[1])
      else log(`server: ${String(chunk).trimEnd()}`)
    })
    child.stderr.on('data', (chunk) => log(`server: ${String(chunk).trimEnd()}`))
    child.once('error', (error) => settle(() => reject(new Error(`failed to spawn server: ${error.message}`)))(undefined))
    child.once('exit', (code, signal) => {
      if (!settled) {
        settle(() => reject(new Error(`server exited before ready (code ${String(code)}, signal ${String(signal)})`)))(undefined)
      } else {
        log(`server exited (code ${String(code)}, signal ${String(signal)})`)
      }
    })
  })
}

const STARTUP_TIMEOUT_MS = 120_000

/** Terminate the server child, escalating from SIGTERM to SIGKILL after 5s. */
function stopServer(child = serverChild) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { child.kill('SIGTERM') } catch { clearTimeout(timer); resolve() }
  })
}

/** Minimal application menu; the bar hides until Alt is pressed. */
function installMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open in Browser', click: () => shell.openExternal(win.webContents.getURL()) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Open the GUI in an app window; external origins go to the system browser. */
function createWindow(url) {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e14',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://')) shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, target) => {
    let next
    try {
      next = new URL(target)
    } catch {
      event.preventDefault()
      return
    }
    const current = new URL(win.webContents.getURL())
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      event.preventDefault()
      return
    }
    if (next.origin !== current.origin) {
      event.preventDefault()
      shell.openExternal(target)
    }
  })
  void win.loadURL(url)
  return win
}

/** Headless self-check: verify the server boots and the GUI receives __DSH_BOOT__. */
async function runSmoke(url) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    log('smoke: loading page')
    await win.loadURL(url, { timeout: 60_000 })
    log('smoke: page loaded')
    const boot = await win.webContents.executeJavaScript('Boolean(window.__DSH_BOOT__)')
    log(`smoke: __DSH_BOOT__=${String(boot)}`)
    if (boot !== true) throw new Error('smoke: window.__DSH_BOOT__ was not injected')
    console.log(`DESKTOP_SMOKE_OK ${url}`)
  } finally {
    win.destroy()
  }
}

async function main() {
  app.setAppUserModelId('ai.deepseek.harness.desktop')
  let child
  let url
  try {
    const started = await startServer()
    child = started.child
    url = started.url
  } catch (error) {
    log(`startup failed: ${error.message}`)
    dialog.showErrorBox('DeepSeek Harness 启动失败', String(error.message))
    app.exit(1)
    return
  }
  serverChild = child
  log(`ready at ${url}`)

  if (SMOKE) {
    try {
      await runSmoke(url)
      console.log('DESKTOP_SMOKE_DONE')
    } catch (error) {
      console.error(`DESKTOP_SMOKE_FAIL ${error.message}`)
      process.exitCode = 1
    } finally {
      await stopServer(child)
      app.exit(process.exitCode ?? 0)
    }
    return
  }

  mainWindow = createWindow(url)
  installMenu(mainWindow)
  mainWindow.on('closed', () => { mainWindow = undefined })

  // The window owns the server: a server that dies on its own is a crash.
  child.once('exit', (code, signal) => {
    log(`server exited unexpectedly (code ${String(code)}, signal ${String(signal)})`)
    if (mainWindow) {
      dialog.showErrorBox(
        'DeepSeek Harness 服务已退出',
        `后端服务意外退出（code ${String(code)}）。请重新启动应用。`,
      )
      mainWindow.destroy()
    }
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('window-all-closed', () => {
    void stopServer().then(() => app.quit())
  })
  process.on('SIGTERM', () => { void stopServer().then(() => app.exit(0)) })
  process.on('SIGINT', () => { void stopServer().then(() => app.exit(0)) })
  void app.whenReady().then(main)
}
