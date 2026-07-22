# Changelog

All notable changes, written for the people who use LivestreamSync — not commit logs.

<!--
  How this works:
  - Add entries under "Unreleased" as features/fixes land on dev, in plain language
    (what changed for the user, not how the code changed).
  - At release time, rename "Unreleased" to "[x.y.z] - YYYY-MM-DD" and tag.
  - The release workflow publishes the matching section as the GitHub release notes
    and REFUSES to build a tag that has no section here.
-->

## Unreleased

- **Twitch chat download** — a new toggle grabs each POV's chat for exactly your
  synced time window, saved next to the clip in two formats: a `.srt` you can drop
  straight onto the timeline as captions, and a `.chat.json` compatible with
  TwitchDownloader if you want to render a full chat overlay. No extra downloads,
  works per streamer, trimmed to the clip. (CLI: `--chat`.)

Timeline export polish — thanks ex for the detailed import notes!

- **Correct pixel aspect ratio** — imported sequences now come in at square pixels
  (1.0) instead of Premiere guessing a DV preset (the mysterious 1.0940).
- **Video and audio import linked** — clips no longer need manual re-linking after
  import; stereo audio now comes in the way Premiere expects it.
- **Sync point marker** — every exported timeline now carries a marker at the exact
  moment all POVs are aligned (your requested start time), so you can verify sync
  at a glance.

## [0.4.0] - 2026-07-02

- **Grab to the end of the VOD** — leave the Stop field empty and LivestreamSync
  downloads from your start time to the end of the stream. (CLI: use `end` as the
  stop time.)
- **Colour-coded timelines** — every POV now gets its own label colour in the
  exported timeline, so you can tell the angles apart at a glance after importing
  into Premiere Pro.

## [0.3.1] - 2026-07-02

- **macOS:** downloads no longer show the "app is damaged" warning on first launch.

## [0.3.0] - 2026-07-02

A big reliability update — thanks to everyone who tried v0.2.0!

- **Correct clips, every time** — re-running a job with a different time range into
  the same folder now re-downloads properly instead of silently reusing the old clip.
- **Live download progress** — per-clip progress bars, checkmarks, and speeds now
  update while the batch runs, and a clip that fails tells you why, right on its row.
- **Cleaner cancels** — cancelling or quitting mid-download now stops the downloads
  fully and cleans up partial files.
- **Timeline import fixes** — exports no longer show "media offline" in
  Premiere/Resolve when your folder or streamer names contain special characters
  like `#` or `%`.
- **Remembers your crew** — streamers from successful runs now appear as one-click
  suggestions on the setup screen.
- Pasting a video link into the streamer box now explains what to do instead of
  failing with a confusing lookup error.
- Fixed the updated macOS first-launch instructions (macOS 15 changed how unsigned
  apps are opened).

## [0.2.0] - 2026-06-29

- First public release! Windows installer + macOS (Apple Silicon) app.
- Multi-POV sync across Twitch and YouTube, exact-window downloads, visual sync
  review, and pre-synced FCP7 XML timeline export for Premiere Pro and DaVinci
  Resolve.

## [0.1.0] - 2026-06-28

- Internal first cut.
