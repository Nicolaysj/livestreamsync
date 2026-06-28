# Contributing to POVsync

Thanks for your interest in POVsync! This is an open-source (MIT) editing tool for
creators, and contributions — bug reports, fixes, features, docs — are welcome.

## Tech stack

- **Electron** desktop shell (main + preload + IPC) — `electron/`
- **Vite + React + TypeScript** renderer (the UI) — `src/`
- **Headless TypeScript engine** (discovery, sync, sliced download, XML export) — `engine/`
- **CLI** that drives the exact same engine — `cli/`
- Shared types / IPC contracts — `shared/`
- Bundled **`ffmpeg`** and auto-updating **`yt-dlp`**, fetched and verified at package time.

There is no Rust/Tauri component — an early design (see [DESIGN.md](DESIGN.md)) considered
Tauri, but the app ships on Electron.

## Prerequisites

- **Node.js 20+**
- For real downloads in development, **`yt-dlp`** and **`ffmpeg`** on your `PATH`.
  (The *packaged* app bundles its own verified copies; this is dev-only.)
  - Windows: `winget install yt-dlp.yt-dlp` and `winget install Gyan.FFmpeg`
  - macOS: `brew install yt-dlp ffmpeg`

The engine resolves these tools in order: env override (`POVSYNC_YTDLP` / `POVSYNC_FFMPEG`)
→ the app's bundled `resources/tools` → your system `PATH`.

## Getting started

```bash
npm install

npm run dev        # full Electron app with hot-reload renderer
npm run dev:web    # renderer only, in a browser — uses a built-in mock so the whole
                   # flow is clickable without yt-dlp/ffmpeg or the desktop shell
npm run typecheck  # tsc --noEmit — please keep this green
```

### Try the headless engine (CLI)

The GUI drives the same engine you can run from the terminal:

```bash
npm run cli -- "https://www.twitch.tv/videos/<id>" 04:40:21 04:55:50 \
  --streamers pokimane,lilypichu,@sydeon \
  --quality source --xml
```

Flags: `--out <dir>`, `--quality source|1080|720`, `--no-anchor`, `--xml`, `--dry`.

## Project layout

| Path | What's there |
|---|---|
| `src/` | React renderer — `App.tsx` drives four stages: Setup → Review → Downloading → Done |
| `src/lib/api.ts` | Renderer API shim; falls back to a realistic **mock** in a plain browser |
| `electron/` | Main process, preload bridge, IPC, Electron hardening |
| `engine/` | Providers (Twitch/YouTube), wall-clock sync, sliced download, FCP7-XML export |
| `cli/` | Thin CLI wrapper over the engine |
| `shared/` | Types shared across renderer / main / engine |
| `build/` | Build + dev scripts (`dev.mjs`, `esbuild.mjs`, `fetch-tools.mjs`) — tracked |
| `docs/` | Screenshots and other documentation assets |

## Packaging the Windows app

```bash
npm run package    # → release/POVsync-Setup.exe (NSIS installer)
```

`npm run package` runs `fetch-tools` (downloads **and SHA-256-verifies** the pinned
`yt-dlp` and `ffmpeg` binaries), builds the renderer and main process, then runs
`electron-builder --win`.

> **Installer note (Windows):** `electron-builder` extracts a `winCodeSign` cache that
> contains macOS symlinks. Creating those on Windows needs **Developer Mode**
> (Settings → Privacy & security → For developers) or an elevated shell. With it enabled,
> `npm run package` produces the installer. The app itself runs fine without it via
> `npm run dev` or the unpacked build. CI builds on a clean `windows-latest` runner, which
> isn't affected.

## Pull requests

1. Branch off `main`.
2. Keep `npm run typecheck` green; match the surrounding code style.
3. Keep changes focused; describe **what** and **why** in the PR.
4. If you change user-facing behavior, update the README and, if relevant, the screenshots
   (regenerate them from `npm run dev:web` — the browser mock renders every screen).
5. Be mindful of the [security model](SECURITY.md) — anything touching process execution,
   URL handling, or the filesystem should preserve the existing guards.

CI (`.github/workflows/ci.yml`) runs install + typecheck on every push and PR.

## Reporting bugs & requesting features

Use the [issue tracker](https://github.com/Nicolaysj/povsync/issues). For bugs, include
your Windows version, what you did, what you expected, and what happened (a screenshot or
the per-streamer skip reason helps a lot).

For anything security-sensitive, please see [SECURITY.md](SECURITY.md) rather than opening
a public issue.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
