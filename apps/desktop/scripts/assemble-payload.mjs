/**
 * Assemble the standalone dsh runtime payload for the packaged desktop app.
 *
 * Steps:
 * 1. `pnpm --filter @deepseek-ai/dsh deploy --prod release/payload` with
 *    config overrides: `inject-workspace-packages` unlocks the non-legacy
 *    deploy path, `link-workspace-packages=false` makes workspace deps pack
 *    into the target's virtual store instead of linking back to the checkout,
 *    and `strict-dep-builds=false` lets the deploy finish without failing on
 *    the one reviewed-elsewhere postinstall (native modules ship prebuilt).
 * 2. Verify the closure: every link inside node_modules must resolve inside
 *    the payload (self-containment), and the web frontend dist, the web-app
 *    bundle, the client bundles, and the koffi platform binary must be
 *    present.
 * 3. Copy this machine's node.exe (the same ABI the native modules were built
 *    for) to release/resources/node/.
 *
 * Run from the workspace root with the system Node after `pnpm run build`.
 * @module @deepseek-ai/dsh-desktop/assemble-payload
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(MODULE_DIR, '..')
const REPO_ROOT = resolve(APP_DIR, '..', '..')
const RELEASE_DIR = join(APP_DIR, 'release')
const PAYLOAD_DIR = join(RELEASE_DIR, 'payload')
const NODE_DIR = join(RELEASE_DIR, 'resources', 'node')

function runPnpm(args, { cwd = REPO_ROOT } = {}) {
  // Prefer the pnpm CLI file when npm/pnpm actually set it for this script
  // (`npm_execpath`); some environments point it at npm-cli.js instead, and
  // spawning `pnpm.cmd` directly from Node on Windows needs a shell.
  const execPath = process.env.npm_execpath
  const isPnpmCli = execPath !== undefined
    && /pnpm[\\/](?:bin[\\/])?pnpm\.(?:cjs|mjs|js)$/i.test(execPath.replaceAll('\\', '/'))
  let command
  let commandArgs
  let shell = false
  if (isPnpmCli) {
    command = process.execPath
    commandArgs = [execPath, ...args]
  } else if (process.platform === 'win32') {
    command = 'pnpm.cmd'
    commandArgs = args
    shell = true
  } else {
    command = 'pnpm'
    commandArgs = args
  }
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
    shell,
    // Headless pnpm must not stall on prompts or treat reviewed-elsewhere
    // build scripts as hard errors inside the deploy target.
    env: { ...process.env, CI: 'true' },
  })
  if (result.error !== undefined) {
    throw new Error(`pnpm ${args.join(' ')} spawn failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

/** The payload directory of one package: hoisted layouts keep every package
 * under node_modules directly; the .pnpm virtual store is the fallback. */
function storePackageDir(root, packageName) {
  const direct = join(root, 'node_modules', ...packageName.split('/'))
  if (existsSync(join(direct, 'package.json'))) return direct
  const store = join(root, 'node_modules', '.pnpm')
  if (!existsSync(store)) return undefined
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.includes('+')) continue
    const pkgDir = join(store, entry.name, 'node_modules', ...packageName.split('/'))
    if (existsSync(join(pkgDir, 'package.json'))) return pkgDir
  }
  return undefined
}

let workspaceNameToDir
function workspacePackageDir(packageName) {
  if (workspaceNameToDir === undefined) {
    workspaceNameToDir = new Map()
    const scan = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.pnpm-store'
          || entry.name === 'release' || entry.name === '.agents') continue
        const abs = join(dir, entry.name)
        if (existsSync(join(abs, 'package.json'))) {
          try {
            const manifest = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8'))
            if (typeof manifest.name === 'string' && !workspaceNameToDir.has(manifest.name)) {
              workspaceNameToDir.set(manifest.name, abs)
            }
          } catch { /* unreadable manifest */ }
        }
        scan(abs)
      }
    }
    scan(REPO_ROOT)
  }
  const dir = workspaceNameToDir.get(packageName)
  if (dir !== undefined) return dir
  return storePackageDir(REPO_ROOT, packageName)
}

/**
 * The dsh runtime closure sometimes imports packages declared only in
 * devDependencies (dsh-app-boot imports @deepseek-ai/cordis-plugin-group for
 * preset composition). Scan every shipped @deepseek-ai lib file for bare
 * specifiers that do not resolve inside the payload and copy the missing
 * packages from the workspace (their real content, without node_modules).
 * @param root - the payload root.
 */
function repairMissingRuntimeImports(root) {
  const requireFrom = createRequire(import.meta.url)
  const scanFile = (file, missing) => {
    let src
    try { src = readFileSync(file, 'utf8') } catch { return }
    const re = /(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g
    let match
    while ((match = re.exec(src)) !== null) {
      const spec = match[1]
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue
      if (spec.includes('${') || spec.includes('`') || spec.includes(' ')) continue
      // A subpath import resolves through its package root; only flag packages
      // whose root directory is absent from the payload.
      const packageRoot = join(root, 'node_modules',
        ...spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1))
      if (existsSync(packageRoot)) continue
      try {
        requireFrom.resolve(spec, { paths: [dirname(file), join(root, 'node_modules')] })
        continue
      } catch { /* unresolved inside the payload */ }
      if (!missing.has(spec)) missing.set(spec, new Set())
      missing.get(spec).add(file)
    }
  }
  const walk = (dir, missing) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(abs, missing)
      } else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) {
        scanFile(abs, missing)
      }
    }
  }
  // Iterate to a fixpoint: the copied packages may import further
  // devDependency-only packages of their own.
  for (let round = 0; round < 10; round += 1) {
    const missing = new Map()
    walk(join(root, 'node_modules', '@deepseek-ai'), missing)
    if (missing.size === 0) return
    for (const [spec, users] of missing) {
      const source = workspacePackageDir(spec)
      if (source === undefined) {
        throw new Error(`payload missing runtime import "${spec}" and the workspace has no such package`)
      }
      const dest = join(root, 'node_modules', ...spec.split('/'))
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(source, dest, {
        recursive: true,
        dereference: true,
        filter: (src) => !relative(source, src).split(sep).includes('node_modules'),
      })
      console.log(`repair: added ${spec} from ${source}`)
    }
  }
}

/**
 * Assert the payload is self-contained: every junction/symlink under
 * node_modules resolves inside the payload. A link back into the workspace
 * checkout would silently tie the installed app to this machine's repo.
 */
function verifySelfContained(root) {
  const problems = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      let isLink = entry.isSymbolicLink()
      if (!isLink) {
        try { isLink = lstatSync(abs).isSymbolicLink() } catch { continue }
      }
      if (isLink) {
        let target
        try { target = realpathSync(abs) } catch { continue }
        if (!target.startsWith(root + sep)) {
          problems.push(`${abs.replace(root + sep, '')} -> ${target}`)
        }
        continue
      }
      if (entry.isDirectory()) walk(abs)
    }
  }
  walk(join(root, 'node_modules'))
  if (problems.length > 0) {
    throw new Error(`payload not self-contained (${String(problems.length)} links escape the payload):\n  ${problems.slice(0, 8).join('\n  ')}`)
  }
}

/**
 * Replace every junction/symlink under node_modules with real directories of
 * hardlinked files. pnpm links packages through junctions even inside a deploy
 * target, and electron-builder's extraResources copy drops junction dirs; a
 * hardlink materialization keeps the payload compact on disk while remaining a
 * plain-file tree that any copy carries intact.
 * @param root - the payload root whose node_modules to materialize.
 */
function materializeLinks(root) {
  const linkOrCopy = (src, dst) => {
    try { linkSync(src, dst) } catch { copyFileSync(src, dst) }
  }
  const copyDir = (src, dst) => {
    mkdirSync(dst, { recursive: true })
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (entry.isDirectory()) copyDir(join(src, entry.name), join(dst, entry.name))
      else if (entry.isFile()) linkOrCopy(join(src, entry.name), join(dst, entry.name))
    }
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      let isLink = entry.isSymbolicLink()
      if (!isLink) {
        try { isLink = lstatSync(abs).isSymbolicLink() } catch { continue }
      }
      if (isLink) {
        const target = realpathSync(abs)
        rmSync(abs, { recursive: true, force: true })
        copyDir(target, abs)
        continue
      }
      if (entry.isDirectory()) walk(abs)
    }
  }
  walk(join(root, 'node_modules'))
}

function verifyPayload(root) {
  const problems = []
  if (!existsSync(join(root, 'lib', 'bin.js'))) problems.push('lib/bin.js (dsh CLI entry)')
  for (const name of ['@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-web-frontend']) {
    if (storePackageDir(root, name) === undefined) problems.push(`${name} (web bundle / frontend)`)
  }
  const frontend = storePackageDir(root, '@deepseek-ai/dsh-web-frontend')
  if (frontend !== undefined) {
    if (!existsSync(join(frontend, 'dist', 'index.html'))) problems.push('dsh-web-frontend dist/index.html')
    if (!existsSync(join(frontend, 'dist', 'assets'))) problems.push('dsh-web-frontend dist/assets')
  }
  // Client bundles: the web GUI's plugin roster is served from lib/client.js.
  const clientModules = storePackageDir(root, '@deepseek-ai/dsh-client-modules')
  if (clientModules === undefined || !existsSync(join(clientModules, 'lib', 'client.js'))) {
    problems.push('dsh-client-modules lib/client.js (browser plugin bundle)')
  }
  // koffi is the session store's FFI; its win32-x64 prebuild is an optional dep.
  if (storePackageDir(root, 'koffi') === undefined) problems.push('koffi (session store FFI)')
  const koffiPrebuild = storePackageDir(root, '@koromix/koffi-win32-x64')
  if (koffiPrebuild === undefined) problems.push('koffi win32-x64 prebuild')
  if (problems.length > 0) {
    throw new Error(`payload incomplete:\n  ${problems.join('\n  ')}`)
  }
}

function bundleNode() {
  const nodeExe = process.execPath
  if (process.platform !== 'win32') {
    throw new Error('assemble-payload currently targets Windows (node.exe bundling); aborting')
  }
  mkdirSync(NODE_DIR, { recursive: true })
  copyFileSync(nodeExe, join(NODE_DIR, 'node.exe'))
  const license = join(dirname(nodeExe), 'LICENSE')
  if (existsSync(license)) copyFileSync(license, join(NODE_DIR, 'LICENSE'))
  console.log(`bundled node: ${nodeExe} -> ${NODE_DIR}`)
}

rmSync(PAYLOAD_DIR, { recursive: true, force: true })
runPnpm([
  '--filter', '@deepseek-ai/dsh',
  'deploy',
  '--config.inject-workspace-packages=true',
  '--config.link-workspace-packages=false',
  '--config.strict-dep-builds=false',
  // Flat, junction-free node_modules: electron-builder's extraResources copy
  // drops pnpm junctions, and a hoisted layout stays a plain directory tree.
  '--config.node-linker=hoisted',
  '--prod',
  PAYLOAD_DIR,
])
verifySelfContained(PAYLOAD_DIR)
verifyPayload(PAYLOAD_DIR)
repairMissingRuntimeImports(PAYLOAD_DIR)
materializeLinks(PAYLOAD_DIR)
bundleNode()
console.log(`payload ready: ${PAYLOAD_DIR}`)
