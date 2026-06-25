# POVsync

Turn **one** anchor stream VOD + a timestamp range into a folder of **perfectly time-aligned multi-POV clips** from every collaborator who was live in that same wall-clock window — plus a **pre-synced Premiere/Resolve timeline** you drop straight into your edit.

> Status: **working Windows app (Electron).** Sync engine, CLI, and the full GUI are built and verified end-to-end; two security + bug analysis rounds passed (see [SECURITY.md](SECURITY.md)). Architecture/UX/roadmap in [DESIGN.md](DESIGN.md).

## What it does

Give it three things:

1. **Anchor stream URL** — one streamer's POV (Twitch or YouTube).
2. **Start / Stop** — the segment, in the anchor's own timeline (e.g. `04:40:21 → 04:55:50`).
3. **Streamers to sync** — a list of handles / channels.

It finds each streamer's VOD that was live during that same wall-clock window, downloads **only that segment at max quality**, aligned to the anchor, and writes a folder of clips ready to stack.

A streamer who wasn't live, kept no VOD, or is sub/members-only is reported **per-streamer** with a clear reason — it never breaks the run; the rest still download.

## How it works (short version)

- **Sync:** anchor on the HLS `EXT-X-PROGRAM-DATE-TIME` wall-clock map (disconnect-immune), with an optional GCC-PHAT **audio fine-sync** that aligns shared voice-call audio to the frame — the same layer that makes mixed Twitch + YouTube timelines trustworthy.
- **Discovery + download:** bundled `yt-dlp` + `ffmpeg`; `--download-sections` fetches only the needed fragments. An optional Cloudflare Worker proxies the official Twitch Helix API so no API secret ships in the app.
- **Export:** hand-generated FCP7-XML (xmeml) places every POV on its own track at the correct frame offset in **both** Premiere and Resolve.

## Platforms

Twitch and YouTube live behind a shared **`Provider`** abstraction (people-centric roster: one collaborator can carry a Twitch handle *and/or* a YouTube channel).

## Stack

Tauri 2 (Rust shell + TypeScript/React UI) · bundled `ffmpeg` · auto-updating `yt-dlp` · optional Cloudflare Worker.

## Roadmap

| Phase | Scope |
|---|---|
| **v0** | Headless engine (CLI): discovery → PDT sync → sliced download → folder + `sync.json` |
| **v1** | GUI MVP — New Job → Auto-detect roster → Sync Preview + live progress |
| **v2** | FCP7-XML export · smart roster · audio fine-sync · sub-only/members auth · **YouTube provider** · ProRes transcode |
| **v3** | Code signing · auto-update · polish (macOS to follow) |

## Responsible use

An internal editing tool for creators working with their own and collaborators' content. It respects platform authentication (no DRM or entitlement bypass — sub/members-only uses your own login), caches metadata only briefly, and keeps downloads local. You are responsible for having the rights to any content you edit and publish.

Not affiliated with Twitch, YouTube, or any streamer.
