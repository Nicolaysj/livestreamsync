# Security posture

LivestreamSync runs untrusted *remote* data (Twitch/YouTube metadata, VODs) through bundled
`yt-dlp` + `ffmpeg`, inside an Electron shell. The threat model and the controls:

## Process execution
- All external binaries are spawned with `child_process.spawn` and an explicit argv
  array — **never a shell** (`shell: false`). No user value can be interpreted as shell
  syntax (`engine/src/exec.ts`).
- The VOD URL is passed after a `--` end-of-options separator so it can never be read as
  a `yt-dlp` flag (blocks argument-injection → RCE), and is **re-validated** with
  `isAllowedVodUrl` both at the Electron IPC boundary and inside the engine
  (`engine/src/download.ts`, `electron/main.ts`).
- Numeric segment fields are clamped to finite ranges before reaching argv.

## Electron hardening
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- A strict Content-Security-Policy is applied in production (`electron/main.ts`).
- `setWindowOpenHandler` denies new windows (only Twitch/YouTube links open externally);
  `will-navigate` is locked to the app's own bundle.
- `shell.openPath` / `showItemInFolder` only act on paths inside user-chosen output
  directories (allow-list), never arbitrary renderer-supplied paths.

## Input validation
- Only `twitch.tv` / `youtube.com` hosts are accepted (`parseStreamUrl`) — the SSRF guard.
- Handles, VOD ids, and filenames are regex-validated / sanitized (control chars, path
  separators, and Windows-reserved names stripped) before any filesystem or process use.

## Authentication
- No secrets are embedded. Subscriber/members-only support (when added) uses the user's
  own session; the app never bypasses entitlement.

## Known residual (build-time only)
- `npm audit` reports advisories in **`tar`** (`node-tar`). This is a transitive,
  **dev/build-time** dependency of `electron-builder` (→ `@electron/rebuild` → `node-gyp`),
  used only to extract official, trusted prebuilt archives during packaging. It is **not
  shipped in the app** and is unreachable at runtime. The patched line (`tar@7`) is
  ESM-only and incompatible with electron-builder's CommonJS tree, so it cannot be forced
  without breaking packaging; tracked until electron-builder ships a patched dependency.
