/**
 * electron-builder afterPack hook: electron-builder's extraResources copy
 * drops `node_modules` (it collects app dependencies instead of copying the
 * directory), so the dsh payload's node_modules is copied in after packaging.
 * @module @deepseek-ai/dsh-desktop/after-pack
 */

const { cpSync, existsSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

/**
 * Copy the assembled payload's node_modules into the packaged app.
 * @param context - electron-builder afterPack context.
 * @returns {Promise<void>}
 */
exports.default = async function afterPack(context) {
  const appDir = resolve(dirname(__dirname))
  const payload = join(appDir, 'release', 'payload', 'node_modules')
  const dest = join(context.appOutDir, 'resources', 'dsh', 'node_modules')
  if (!existsSync(payload)) {
    throw new Error(`after-pack: payload node_modules missing at ${payload}; run "pnpm assemble" first`)
  }
  cpSync(payload, dest, { recursive: true, dereference: true })
  console.log(`after-pack: copied payload node_modules -> ${dest}`)
}
