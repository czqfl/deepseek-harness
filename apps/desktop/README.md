# @deepseek-ai/dsh-desktop

Windows desktop shell for the DeepSeek Harness Web GUI. The shell spawns the
local `dsh web` server as a child process, opens it in an Electron window, and
owns the server's lifecycle: closing the window terminates the server; an
unexpected server exit surfaces an error and quits the app.

## Layout

```
apps/desktop/
  main.mjs                  Electron main process (window + server lifecycle)
  electron-builder.yml      NSIS/portable packaging configuration
  scripts/
    make-icon.mjs           generate build/icon.png from apps/web/public/favicon.svg
    ensure-electron.mjs     offline electron binary bootstrap (extract cached zip)
    assemble-payload.mjs    assemble the standalone dsh runtime payload
    after-pack.cjs          electron-builder hook: restore payload node_modules
  release/                  electron-builder output + assembled payload (gitignored)
```

## Requirements

- Windows 10/11
- Node ^22.19 || >=24 and pnpm (the workspace's normal toolchain)
- Built artifacts: `pnpm run build` from the repository root (host libs,
  client bundles, and the web frontend dist)
- The electron binary. In offline environments (local npm mirror, no GitHub)
  installs skip the download with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; run
  `pnpm --filter @deepseek-ai/dsh-desktop run electron:extract` afterwards to
  unpack the cached `electron-v28.3.3-win32-x64.zip` from
  `%LOCALAPPDATA%\electron\Cache`.

## Run (desktop shell over this checkout)

```sh
pnpm run build          # once: host/client libs + apps/web/dist
pnpm --filter @deepseek-ai/dsh-desktop run start
```

The shell binds `127.0.0.1` on an OS-assigned free port (set
`DSH_DESKTOP_PORT` to pin one) and opens the GUI in its own window. API keys
and settings come from the same places `dsh web` reads: ambient environment,
the repo's `.env`, and `$DSH_HOME` (default `~/.dsh`).

Self-check (headless, for CI or debugging):

```sh
pnpm --filter @deepseek-ai/dsh-desktop run smoke
```

Prints `DESKTOP_SMOKE_OK <url>` and exits 0 when the server boots and the page
received `window.__DSH_BOOT__`.

## Build the standalone app

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run icon        # build/icon.png
pnpm --filter @deepseek-ai/dsh-desktop run assemble    # release/payload + bundled node
pnpm --filter @deepseek-ai/dsh-desktop run dist        # NSIS installer (release/)
pnpm --filter @deepseek-ai/dsh-desktop run dist:portable   # single portable exe
```

Artifacts (in `apps/desktop/release/`):

- `DeepSeek Harness-Setup-<version>.exe` — NSIS installer (choose directory,
  desktop shortcut).
- `DeepSeek Harness-Portable-<version>.exe` — single-file portable app.
- `win-unpacked/DeepSeek Harness.exe` — unpacked app directory.

`assemble` deploys a production closure of the dsh CLI into `release/payload`
with a hoisted, junction-free `node_modules`, repairs devDependency-only
runtime imports (dsh-app-boot imports `@deepseek-ai/cordis-plugin-group` for
preset composition, etc.), and bundles this machine's `node.exe`, so the
installed app runs without the repository checkout or a Node installation.
Keys still come from the environment or `~/.dsh/.env`.

Use `dist:dir` for an unpacked directory build (fast iteration).

## Notes

- The web bundle prints `dsh web: http://127.0.0.1:<port>` once its Loader tree
  settles; the shell treats that line as the readiness signal (`--port 0`
  therefore works).
- The server child is terminated when the window closes. Sessions are durable
  (JSONL under `$DSH_HOME`), so this is equivalent to closing the browser tab.
- External links open in the system browser; same-origin navigation stays in
  the window.
- electron-builder's extraResources copy drops `node_modules` (it collects app
  dependencies instead); `scripts/after-pack.cjs` restores the payload's
  node_modules after packaging.
