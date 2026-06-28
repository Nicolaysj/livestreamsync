# Multi-POV Twitch + YouTube VOD Sync & Download — Buildable Design Doc

**Codename:** LivestreamSync · **Owner:** technical (Node/JS, Docker, Cloudflare) · **Audience:** ~3–5 non-technical video editors · **Platform:** Windows-first, macOS planned · **Date:** 2026-06-25

> [!NOTE]
> **This is the original design/vision document, not a description of the shipped app.**
> Some parts describe an earlier or planned direction and are **not** what currently ships:
> - The app is built on **Electron**, not Tauri.
> - Sync is **wall-clock/timestamp-based only**. Audio fine-sync (GCC-PHAT), the Cloudflare
>   Worker / Twitch Helix fallback, ProRes/DNxHR transcode, and the Resolve Multicam helper
>   are **not implemented** — they're ideas/roadmap.
>
> For what actually ships today, see the [README](README.md); for how to build it, see
> [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 1. Executive Summary

We are building a desktop app that turns *one* editor input — an anchor Twitch VOD plus a timestamp range (e.g. `04:40:21–04:55:50`) — into a folder of **perfectly time-aligned POV clips** from every collaborator who was live in that same wall-clock window, plus a **pre-synced NLE timeline** the editor drops straight into Premiere or Resolve. The manual yt-dlp + ffmpeg workflow is already proven (a 15.5-min 1080p60 cut in ~10s at ~70 MB/s, alignment exact 7h25m into a 7.9h VOD); this app makes it one-click and idiot-proof.

**The three features that make it feel magic:**

1. **Auto-roster detection.** Editor saves the QuarterJade friend-group once. Paste an anchor VOD + range → the app instantly shows *who else was live*, with a status chip per person (covered / partial / gap / no-VODs / needs-login). No hunting for VOD URLs.
2. **The Sync Preview timeline.** *Before* downloading anything, the editor sees a stacked timeline showing each POV's clip positioned at its real offset, with a green confidence band — they confirm the sync visually, then hit download.
3. **One-file pre-synced NLE export.** A single FCP7-XML drops every POV onto its own track at the correct frame offset in Premiere *and* Resolve, with an optional one-click "open as Multicam in Resolve."

---

## 2. Architecture (in words)

```
┌─────────────────────────── DESKTOP APP (Tauri 2 / Rust core + web UI) ───────────────────────────┐
│                                                                                                  │
│  UI (TS/React)  ──IPC──►  Engine (Rust, off-thread)                                               │
│                              │                                                                    │
│                              ├─► DISCOVERY                                                         │
│                              │      1. GraphQL via bundled yt-dlp (-J) ── default, credential-free │
│                              │      2. Cloudflare Worker /match  ──────── official Helix fallback   │
│                              │                                                                    │
│                              ├─► SYNC                                                              │
│                              │      Layer 1: fetch each VOD's HLS m3u8, parse EXT-X-PROGRAM-DATE-  │
│                              │               TIME → wall-clock↔position map  (segment-accurate)    │
│                              │      Layer 2 (opt): audio GCC-PHAT cross-correlation → sub-frame     │
│                              │                                                                    │
│                              ├─► DOWNLOAD: spawn yt-dlp sidecar, --download-sections, stream JSON  │
│                              │             progress; ffmpeg sidecar only if re-encode needed       │
│                              │                                                                    │
│                              └─► EXPORT: generate FCP7-XML (xmeml) + optional Resolve multicam py  │
│                                                                                                    │
│  Bundled sidecars: ffmpeg (stable, bundled) · yt-dlp (download-on-first-run, SHA-256 pinned)       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
            │ HTTPS                                   │ HTTPS (fallback only)
            ▼                                         ▼
   gql.twitch.tv / *.hls.ttvnw.net          Cloudflare Worker (holds client_secret,
   (yt-dlp, credential-free read +           caches 1 Helix app token in KV, read-only
    authed HLS fragment fetch)               /resolve /videos /match)  ──►  api.twitch.tv/helix
```

The app is **self-contained**: it works fully even if the Worker is offline (GraphQL-via-yt-dlp is primary). The Worker is an *optional* official-API safety net the owner controls. Auth (for sub-only) is the editor's own Twitch session, never embedded.

---

## 3. Tech Stack Decision

**Winner: Tauri 2.x** (Rust core + TypeScript/React UI, `electron-builder`-equivalent via `tauri-action`).
**Runner-up: Electron** (all-JS, larger).

| Factor | Tauri 2 | Electron |
|---|---|---|
| Installer size | ~3–10 MB shell | ~85–244 MB (Chromium) |
| Sidecar spawn + stream | First-class `Command.sidecar` (TS) + capability scoping | `child_process.spawn` in main (JS) |
| Auto-updater | Built-in (Ed25519-signed `latest.json`) | electron-updater (more battle-tested) |
| Signing | Native `signCommand` for Win + Apple notarize | Mature |
| Language for the core | TS for the simple case; Rust available for off-thread/concurrency | 100% JS |

**Why Tauri wins here (reversing one research finding):** the research recommended Electron on the premise that the spawn/parse core *must* be Rust in Tauri. That premise is wrong — Tauri 2's **JS shell plugin** (`@tauri-apps/plugin-shell`, `Command.sidecar(...).spawn()` with `cmd.stdout.on('data', …)`) lets a Node/JS owner write the entire spawn-and-parse logic in TypeScript with **zero Rust** (verified against current Tauri 2 docs). That neutralizes Electron's only real advantage. Meanwhile this app:

- runs **6 concurrent POV downloads** at ~70 MB/s + audio cross-correlation — heavy CPU/I/O work that benefits from being off the UI thread (clean in Rust when you want it),
- ships ffmpeg (~80 MB) regardless, so a tiny shell keeps the *app* updatable independently of the toolchain,
- has a tiny attack surface but Tauri's capability allowlist makes "spawn only these two binaries" explicit and auditable.

The headline size win is irrelevant for 5 editors — but combined with first-class sidecars, a built-in signed updater, and **no-Rust-required** spawn/parse, Tauri is the better fit. Pick Electron only if the owner wants to avoid *any* Rust toolchain in CI; the velocity gap is now small.

**UI lib:** React + Vite + a lightweight component set (shadcn-style). The signature Sync Preview timeline is a custom canvas/SVG component.

**Sidecar gotchas (verified):**
- ffmpeg writes progress to **stderr** and uses `\r` overwrites — listen to **both** streams; use `ffmpeg -progress pipe:1 -nostats` for clean `key=value` lines and `yt-dlp --newline --progress-template "download:%(progress)j"` for newline-terminated JSON.
- Tauri sidecars need the **target-triple suffix on disk** (`yt-dlp-x86_64-pc-windows-msvc.exe`) but are called by base name.
- Capability `"args": true` (or explicit validators) is required or dynamic URL/arg calls are blocked.

---

## 4. The Auto-Sync Engine

### 4.1 Discovery — strategy & matching

**Primary: GraphQL via bundled yt-dlp** (credential-free, no secret, no Worker dependency). yt-dlp's Twitch extractor (verified against master, 2026-06) uses Client-ID `ue6666qo983tsx6so1t0vnawi233wa` and persisted-query `FilterableVideoTower_Videos` (`67004f7881e65c297936f32c75246470629557a393788fb5a69d6d9a25a8fd5f`) and `VideoMetadata` (`45111672…084d`) to list archives with `publishedAt` (wall-clock start) and `lengthSeconds` (duration). **Shell out to yt-dlp `-J` rather than hand-rolling GraphQL** so the community absorbs hash/Client-ID rotation.

> ⚠️ **Correction to one research snippet:** the `FilterableVideoTower_Videos` hash must be paired with the **Switch Client-ID** `ue6666qo983tsx6so1t0vnawi233wa` that yt-dlp actually ships, *not* the web ID `kimne78kx3ncx6brgo4mv6wki5h1ko`. Don't hand-roll; call yt-dlp.

**Fallback: Cloudflare Worker → official Helix** when GraphQL returns empty/errors or flags private/sub-only. Helix `Get Videos?type=archive&sort=time` returns `created_at` + `duration` ("`6h26m14s`").

**Matching algorithm (interval containment):**

```
// All math in epoch milliseconds, UTC. Never parse as local time. (DST-proof.)
windowStart = anchorWallclockStart + offsetIntoAnchorSec*1000   // see 4.2 for true anchor
windowEnd   = windowStart + clipLengthSec*1000

function findCoveringVod(vods, windowStart, windowEnd):   // vods newest-first
  for v in vods:
    start = epoch(v.publishedAt | v.created_at)
    end   = start + durToSec(v.duration)*1000
    overlaps = start <= windowEnd && end >= windowStart
    if overlaps:
      return { vod: v,
               fullyCovers: start <= windowStart && end >= windowEnd,
               offsetSec: max(0, (windowStart - start)/1000),
               subOnly:   v.viewable && v.viewable != 'public' }
  return null      // first-class outcome: gap / no-VOD channel (e.g. Michael Reeves)

durToSec(d): m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(d)
             return (m1||0)*3600 + (m2||0)*60 + (m3||0)
```

Run the whole roster at concurrency 5; classify each member `covered | partial | gap | no-vods | needs-auth`.

### 4.2 The layered sync model — **anchor on PDT, not `created_at`**

The adversarial verification confirmed and sharpened the core risk: **`created_at` is NOT the exact recording start** (Twitch staff confirm it lags `started_at` by seconds-to-tens-of-seconds), and — critically — **stream disconnects compress downtime in the VOD timeline** (the disconnect slate is *shorter* than the real outage), making `created_at + linear_offset` overshoot by a cumulative, undetectable amount after any mid-stream drop. A reconnect keeps **one continuous VOD** (~90s with Disconnect Protection); only a true stream-end starts a new VOD.

**Therefore the engine does NOT trust `created_at` for the final offset.** It uses `created_at`+duration only for the *coarse containment test* (which VOD to fetch), then anchors precisely on the HLS playlist.

**Layer 1 — PDT wall-clock map (always on, segment-accurate ≈ ±2s, disconnect-immune):**

`EXT-X-PROGRAM-DATE-TIME` (PDT) per segment is confirmed present on Twitch VODs (per-discontinuity at minimum, which is exactly where it matters; Twitch's own instant-clip system relies on it). Each segment self-reports real wall-clock, so the map survives discontinuities that break any linear assumption.

```python
PDT = re.compile(r'#EXT-X-PROGRAM-DATE-TIME:(.+)')
INF = re.compile(r'#EXTINF:([0-9.]+)')

def segment_timeline(m3u8_text):
    pos, anchors = 0.0, []
    for line in m3u8_text.splitlines():
        m = PDT.match(line)
        if m: anchors.append((pos, dt.datetime.fromisoformat(m.group(1).replace('Z','+00:00'))))
        m = INF.match(line)
        if m: pos += float(m.group(1))
    return anchors   # detect a disconnect: wallclock delta >> EXTINF between adjacent anchors

def wallclock_to_vod_pos(anchors, target_wc):
    for (p0,t0),(p1,t1) in zip(anchors, anchors[1:]):
        if t0 <= target_wc < t1:
            frac = (target_wc-t0).total_seconds()/(t1-t0).total_seconds()
            return p0 + frac*(p1-p0)
    return None        # target_wc not covered by this VOD → real "no coverage"
```

Get the per-quality m3u8 URL with `yt-dlp -g -f best <vod-url>`, fetch it (with the editor's cookies if sub-only), parse PDT. The **anchor's** PDT map converts the editor's `HH:MM:SS` into an absolute wall-clock `windowStart`; each other POV's PDT map converts that `windowStart` back into *their* exact VOD position. `return None` IS the gap case.

> If PDT is unavailable on a given playlist, fall back to `created_at + offset` and lower the confidence badge.

**Layer 2 — audio fine-sync (optional, auto-detected, sub-frame):**

After downloading coarse-aligned slices (padded ±4s, see 4.3), decode a mono 8 kHz mix of each POV's overlap and snap to the anchor with **GCC-PHAT** (more robust than plain correlation for differing mics/rooms — the collab case). Gate on a confidence score from peak prominence + an RMS/silence check.

```python
def fine_offset(anchor, other, sr=8000):
    if anchor.std()<1e-4 or other.std()<1e-4: return 0.0, 0.0   # muted/silent → bail
    A, B = np.fft.rfft(anchor), np.fft.rfft(other)
    R = A*np.conj(B); R /= np.abs(R)+1e-9                        # PHAT whitening
    cc = np.fft.irfft(R); cc = np.fft.fftshift(cc)
    k = int(np.argmax(cc)); lag = k - len(cc)//2
    peak = cc[k]; conf = float(max(0,min(1,(peak-np.median(cc))/(cc.std()+1e-9)/12)))
    # parabolic interpolation around k → sub-sample precision
    return lag/sr, conf
```

Auto-apply only when `conf > ~0.5`; else keep coarse PDT sync, show a "couldn't fine-tune — shared audio not detected" badge + manual frame-nudge slider. Build **in-house GCC-PHAT (~60 lines)**, not the `audalign` dependency — fewer deps, full control of the confidence metric for a distributable app. **No drift/stretch correction** for typical ≤30-min clips (drift <0.1 ms over 15 min — sub-frame); only consider it for >30–60 min clips.

### 4.3 Download — quality & exact slicing

```bash
PAD=4                                   # yt-dlp cuts on 0–4s fragment boundaries, not frames
START=$(max 0, OFFSET_SEC - PAD)
END=$((OFFSET_SEC + LEN_SEC + PAD))
yt-dlp -f best \
  --download-sections "*${START}-${END}" \
  --newline --progress-template "download:%(progress)j" \
  --no-keep-fragments \
  -o "%(uploader)s_%(id)s.%(ext)s" \
  "https://www.twitch.tv/videos/${VOD_ID}"
# sub-only: add the editor's auth (see §7). Do NOT add --force-keyframes-at-cuts (forces slow re-encode).
```

Padding ±4s guarantees the true window is inside the slice (the fine-sync layer or editor trims), eliminating fragment-boundary error. HLS only fetches needed fragments, so padding is nearly free. Drive the progress bar from the JSON: `downloaded_bytes/total_bytes`, falling back to `total_bytes_estimate`, then `fragment_index/fragment_count` (most reliable for Twitch HLS).

### 4.4 Graceful edge cases (deterministic, all first-class UI states)

| Case | Detection | UX |
|---|---|---|
| Stream gap / channel kept no VOD | `findCoveringVod`→null or empty archives | "No VOD covering this window" (grey, skipped) |
| Disconnect mid-VOD | PDT delta ≫ EXTINF / `EXT-X-DISCONTINUITY` | Use PDT lookup (auto-correct); flag if window lands in dead air |
| Sub-only | `viewable != public` or 403 on fetch | "Subscriber-only — Connect Twitch" (§7) |
| Still-processing / live | recent `created_at`, `stream_id` set, growing duration | use GraphQL `lengthSeconds` / retry |
| Deleted/expired | nothing on Helix | try GraphQL cache; else "unavailable (expired)" + date |

**VOD retention (verified 2026):** regular **7 days**, Affiliate **14**, Partner/Prime/Turbo **60**. Surface a "this VOD expires in N days" hint and prompt editors to run soon after broadcast. Cache discovered metadata locally (≤24h, see §10) so re-cuts within the window work offline.

---

## 4b. Multi-Platform Providers — adding YouTube

The engine is built around a `Provider` interface so Twitch and YouTube are interchangeable implementations; everything downstream (matching, Sync Preview, download, export) is platform-agnostic. **Put the abstraction in from v0** so YouTube is not a retrofit.

```typescript
interface AbsWindow { startMs: number; endMs: number; }            // epoch ms, UTC
interface ResolvedSegment {
  vodId: string; url: string;
  startMs: number; durationSec: number;        // [startMs, startMs+dur] = wall-clock coverage
  offsetSec: number;                           // where the window begins inside THIS vod
  trust: 'tight' | 'coarse';                   // Twitch=tight (PDT), YouTube=coarse (needs audio sync)
  status: 'covered' | 'partial' | 'subOnly' | 'processing';
}
interface Provider {
  platform: 'twitch' | 'youtube';
  // returns an ARRAY: a YouTube encoder-restart splits one session into several VODs
  resolveWindow(handle: string, win: AbsWindow): Promise<ResolvedSegment[]>;
}
```

**Roster becomes people-centric:** `Person { twitch?, youtube? }`; auto-detect fans out to every identity a collaborator carries (some of QJ's circle are YouTube-primary). The 3-input contract is unchanged — a streamer-list entry is just "a Twitch handle *or* a YouTube channel."

**YouTube specifics (verified):**

- **Anchor = the stream's *actual* start.** Use Data API `liveStreamingDetails.actualStartTime` when a key is configured; otherwise yt-dlp's `release_timestamp` — but **validate `start + duration ≈ actualEndTime`**, because yt-dlp issue #5634 shows `release_timestamp` can occasionally return the *end* time. Never anchor on `timestamp`/`upload_date` (the upload moment, hours off).
- **Trust is `coarse`, so audio fine-sync is mandatory for any YouTube/mixed timeline.** Creators can trim a VOD (re-zeroing the playable timeline while `actualStartTime` stays fixed), so the timestamp offset can be off by seconds-to-minutes. GCC-PHAT (§4.2 Layer 2) absorbs it; below the confidence threshold the clip is flagged "coarse — nudge manually."
- **Discovery, no key required:** `yt-dlp --flat-playlist https://www.youtube.com/@HANDLE/streams` lists past-stream IDs (0 quota); resolve each candidate's anchor with `yt-dlp -J` *or* a batched Data API `videos.list` (50 IDs / 1 quota unit, optional, behind the same Worker). **Never `search.list`** (100 units). One session → possibly several VODs: overlap-match them all and stitch.
- **⚠️ The slicing trap:** since late-2025 YouTube serves SABR/DASH-only to default clients, where `--download-sections` stops range-fetching and pulls the *whole* multi-hour VOD (~30× slower). **Force an HLS client** — `--extractor-args "youtube:player_client=web_safari"` (fallback `tv`→`ios`) — and verify the chosen format is `m3u8`/hls before slicing.
- **Codec:** max quality is VP9/AV1 up to 4K, which edits badly. **Default = download then transcode to ProRes 422 HQ (or DNxHR), keep source as opt-out** (Open Decision #7). Twitch (H.264) needs no transcode.
- **Auth (members-only):** identical to Twitch sub-only — Firefox cookies / `cookies.txt` (Chrome extraction is broken on Windows).
- **Ops:** `live_status == 'post_live'` means the archive is still processing (~15–30 min) → defer/retry. YouTube breaks yt-dlp roughly monthly, which the **download-on-first-run + SHA-pinned tools-manifest** (§9) already handles via an in-app "Update tools."

**Roadmap placement:** the `Provider` interface ships in **v0**; the Twitch provider is v0/v1; the **YouTube provider + ProRes transcode land in v2** alongside audio fine-sync (which YouTube needs anyway).

---

## 5. Cloudflare Worker Discovery-Proxy

**Keep it — but as an optional fallback, not the primary path.** Rationale: GraphQL-via-yt-dlp is credential-free and primary, so the app works with the Worker offline. The Worker exists to (a) never ship the `client_secret`, (b) give an *official-API* path that degrades gracefully when Twitch rotates GraphQL hashes. It's ~80 lines, $0 at this scale. **Never embed the secret** (violates the Developer Services Agreement; 25-active-token cap makes per-client minting impossible anyway).

**Endpoints (read-only):** `/resolve?login=` → user_id · `/videos?user_id=` → archives (KV-cached 60s) · `/match?login=&start=` → the covering VOD + offset.

**Secret handling:** `client_secret` as a wrangler secret; one Helix **app token** minted via client-credentials, cached in **KV** with `expirationTtl = expires_in − 300` (app tokens last ~58 days). **Abuse protection:** `X-App-Key` shared key baked into the trusted build; input regex validation; optional Cloudflare WAF rate-limit on the route. **Caching:** 60s KV on `/videos`; honor Helix `Ratelimit-Reset` on 429 (800 pts/min ≫ a few editors).

```javascript
// src/index.js — skeleton (secrets: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, APP_SECRET; KV: TWITCH_KV)
const HELIX='https://api.twitch.tv/helix', TOKEN_URL='https://id.twitch.tv/oauth2/token', TK='helix_app_token';
async function getAppToken(env){
  const c=await env.TWITCH_KV.get(TK); if(c) return c;
  const r=await fetch(TOKEN_URL,{method:'POST',body:new URLSearchParams({
    client_id:env.TWITCH_CLIENT_ID,client_secret:env.TWITCH_CLIENT_SECRET,grant_type:'client_credentials'})});
  const j=await r.json();
  await env.TWITCH_KV.put(TK,j.access_token,{expirationTtl:Math.max(60,(j.expires_in??3600)-300)});
  return j.access_token;
}
async function helix(env,p){
  const t=await getAppToken(env);
  let r=await fetch(HELIX+p,{headers:{'Client-Id':env.TWITCH_CLIENT_ID,Authorization:'Bearer '+t}});
  if(r.status===401){await env.TWITCH_KV.delete(TK);const t2=await getAppToken(env);
    r=await fetch(HELIX+p,{headers:{'Client-Id':env.TWITCH_CLIENT_ID,Authorization:'Bearer '+t2}});}
  return r;
}
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});
export default { async fetch(req,env){
  if(env.APP_SECRET && req.headers.get('X-App-Key')!==env.APP_SECRET) return json({error:'forbidden'},403);
  const u=new URL(req.url);
  if(u.pathname==='/match'){
    const login=(u.searchParams.get('login')||'').toLowerCase(), startMs=Date.parse(u.searchParams.get('start')||'');
    if(!/^[a-z0-9_]{1,30}$/.test(login)||isNaN(startMs)) return json({error:'bad params'},400);
    const uid=(await (await helix(env,'/users?login='+login)).json()).data?.[0]?.id;
    if(!uid) return json({error:'user not found'},404);
    for(const v of (await (await helix(env,`/videos?user_id=${uid}&type=archive&first=100&sort=time`)).json()).data||[]){
      const s=Date.parse(v.created_at), e=s+durSec(v.duration)*1000;
      if(startMs>=s&&startMs<e) return json({found:true,video:v,offset_seconds:Math.floor((startMs-s)/1000)});
    }
    return json({found:false});
  }
  return json({error:'not found'},404);
}};
function durSec(d){const m=/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(d||'')||[];return (+(m[1]||0))*3600+(+(m[2]||0))*60+(+(m[3]||0));}
```

---

## 6. NLE Pre-Synced Export

**Winner: hand-generated FCP7 XML (xmeml, `<!DOCTYPE xmeml> version 5`)** — the only format both **Premiere Pro** and **DaVinci Resolve** import reliably with each POV on its own track at correct frame offsets.

**Rejected/caveated (per verification):**
- **FCPXML** is lane/spine-based (no tracks); stacked clips collapse into one linked clip in Resolve/Premiere → don't lead with it. Reserve only for native Final Cut export later.
- **OpenTimelineIO `fcp_xml` adapter** is silently rejected by Resolve 17+ (missing `<format>` tag, issue #839) → do not use for the Resolve path. Hand-roll xmeml where we emit every tag.
- **EDL** — single track, no multi-track. Skip.
- One XML can't target all three NLEs: FCP reads *only* FCPXML, Premiere *only* xmeml, Resolve *both*. We target Premiere+Resolve with xmeml.

**Placement:** one `<track>` per POV; each `<clipitem>` positioned by **integer frame** `start`/`end`. With the `--download-sections` slice approach each file already starts at the window, so `in=0`; a POV that went live *mid-window* gets a leading gap via `start>0`.

**Frame math (do NOT confuse 60 vs 59.94):** Twitch Source is **true 60** → `<timebase>60</timebase><ntsc>FALSE</ntsc>`. Use `ntsc TRUE` only for 29.97/59.94. Detect each source's true rate via ffprobe; store per-clip rate in its `<file>` samplecharacteristics so mixed-rate POVs conform. All offsets = `round(sec*fps)` to land on edit-frame boundaries.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
 <sequence id="seq-1">
  <name>QuarterJade_collab_2026-06-24_LivestreamSync</name>
  <duration>55740</duration>                <!-- 15m29s @ 60fps -->
  <rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate>
  <media><video>
   <format><samplecharacteristics>
     <rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate><width>1920</width><height>1080</height>
   </samplecharacteristics></format>
   <!-- TRACK 1: anchor -->
   <track><clipitem id="ci-1"><name>QuarterJade_POV.mp4</name>
     <rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate>
     <start>0</start><end>55740</end><in>0</in><out>55740</out>
     <file id="f-1"><name>QuarterJade_POV.mp4</name>
       <pathurl>file://localhost/C:/LivestreamSync/QuarterJade_POV.mp4</pathurl>
       <rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate><duration>55740</duration></file>
   </clipitem></track>
   <!-- TRACK 3: LilyPichu went live 5s into the window → 300-frame leading gap -->
   <track><clipitem id="ci-3"><name>LilyPichu_POV.mp4</name>
     <rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate>
     <start>300</start><end>55740</end><in>0</in><out>55440</out>
     <file id="f-3"><name>LilyPichu_POV.mp4</name>
       <pathurl>file://localhost/C:/LivestreamSync/LilyPichu_POV.mp4</pathurl>
       <rate><timebase>60</timebase><ntsc>FALSE</ntsc></rate><duration>55440</duration></file>
   </clipitem></track>
  </video></media>
 </sequence>
</xmeml>
```

**Media relink:** write all clips into the *same folder* as the XML; emit absolute `file://` URLs to that folder. Filenames match, so NLEs fall back to filename relink; worst case the editor gets a normal "locate media" prompt. **Audio:** keep each POV's audio *linked to its own video clipitem* (Resolve has a longstanding multi-audio-track XML import bug) and let the editor solo/mute per angle.

**Resolve multicam (the standout extra):** ship a bundled DaVinciResolveScript that `ImportTimelineFromFile`s the xmeml then converts to a true multicam clip (`angleSyncMethod:"In"` — positions are already correct, **don't** re-sync by audio). Detect API availability; **fallback** = printed instruction "right-click the imported timeline → Convert Timeline to Multicam Clip."

---

## 7. Authentication for Sub-Only VODs

**Primary: in-app Twitch device-code login.** Browser-independent, identical on Win/macOS, ~30s, no dev-app registration. Use Twitch's first-party **Nintendo Switch client_id `ue6666qo983tsx6so1t0vnawi233wa`** (the same one yt-dlp ships and gql honors for VOD playback).

```javascript
const CLIENT_ID='ue6666qo983tsx6so1t0vnawi233wa';
// 1) POST id.twitch.tv/oauth2/device {client_id, scopes} → {device_code,user_code,verification_uri,interval}
// 2) Poll id.twitch.tv/oauth2/token grant_type=urn:ietf:params:oauth:grant-type:device_code until access_token
```

**Inject into yt-dlp via a generated cookies.txt** (most version-robust path — avoids `--add-header` colon-spacing quirks):

```javascript
function writeTwitchCookies(path, authToken){
  const exp=Math.floor(Date.now()/1000)+31536000, eol=process.platform==='win32'?'\r\n':'\n';
  writeFileSync(path,['# Netscape HTTP Cookie File',
    `.twitch.tv\tTRUE\t/\tTRUE\t${exp}\tauth-token\t${authToken}`,
    `.gql.twitch.tv\tTRUE\t/\tTRUE\t${exp}\tauth-token\t${authToken}`].join(eol)+eol);
}
// yt-dlp --cookies twitch_cookies.txt URL
```
(yt-dlp's extractor sends `Authorization: OAuth <auth-token>` — verified against master.)

**Fallbacks, in order:** (A) **Firefox** `--cookies-from-browser firefox` — the *only* browser path that still works on Windows (plain SQLite, ABE-proof); probe `%APPDATA%/Mozilla/Firefox/Profiles/*/cookies.sqlite` for an auth-token to offer it silently. (B) In-app Electron/webview login scraping the `auth-token` cookie.

**Do NOT:**
- ❌ Chrome/Edge/Brave/Opera `--cookies-from-browser` on **Windows** — **permanently broken** by Chrome 127+ App-Bound Encryption (`failed to decrypt with DPAPI` → `'NoneType' object has no attribute 'decode'`; v20 cookies, no yt-dlp fix as of 2026). *Correction to one research note:* a plain "manual cookies.txt export" (copying the SQLite DB) does **not** work either — only an *in-browser* extension like "Get cookies.txt LOCALLY" can, since the browser decrypts before export.
- ❌ username/password (CAPTCHA/2FA-blocked, dead).
- ❌ never bypass entitlement — pass the editor's own session; if they're not subscribed, fail closed with "your connected account isn't subscribed to X" and continue with the other POVs.

**Store the token in OS-native secure storage** (Windows Credential Manager / macOS Keychain via keytar), never plaintext. Keep `client_id` configurable (it's an `--extractor-args` value) so a Twitch rotation doesn't brick the app. Gate the whole feature behind a "Connect Twitch" button that only appears when a download 403s as sub-only (95%+ of these collab VODs are public).

---

## 8. Full UX

**Screen flow (MVP = screens 1–3; full = 1–5 + login):**

1. **New Job.** Paste anchor VOD URL (or pick from recent). Parse both timestamp forms — `t=04h40m21s` and legacy `t=102m38s` — echo back `HH:MM:SS`. Enter end time (or duration). Pick a roster preset.
2. **Auto-detect POVs (the roster screen).** One click runs the whole roster through the containment test. Each member is a card: avatar, name, **status chip** (`covered`✅ / `partial`◐ / `gap`⊘ / `no-vods` / `needs-login`🔒), auto-selected if covered/partial. "+ Add a handle" escape hatch. Covered count headline ("5 of 7 POVs found").
3. **★ Sync Preview (the hero).** A stacked timeline: anchor on top, each POV as a bar positioned at its real offset. A **green confidence band** spans the region the engine is confident about (full where a VOD comfortably brackets the window, tapering near VOD edges); gaps render grey; partial POVs show their leading/trailing grey. A confidence dot per POV (PDT-only vs audio-snapped). The editor scrubs, eyeballs alignment, optionally drags a **frame-nudge** on any POV. Then **Download all**.
4. **Download progress.** Per-POV rows with live bars (JSON progress), speed/ETA, ✓ on done; sub-only rows show a "Connect Twitch" inline action; failures show a friendly reason + retry.
5. **Done / Export.** "Open folder," "Export Premiere/Resolve XML," "Open as Multicam in Resolve." Shows expiry hint and a one-line "what got skipped and why."

**Roster / presets:** named presets ("QJ circle," "game night crew") chosen per project. Auto-expand candidates via **shared Twitch Team membership** (clean Helix), each confirmed by the containment test. **Experimental (flagged):** chat co-mention mining from the anchor VOD (gql `VideoCommentsByOffsetOrCursor`) to *suggest* unlisted collaborators — always confirmed by the deterministic overlap test before auto-selecting. Out of scope: raids (EventSub-only, not retroactive), Guest Star (owner-token only), follow lists (deprecated 2022).

**Friendly error states** (never raw stack traces): "No VOD covering this window — they may have been offline or kept no VOD." · "Subscriber-only — connect your Twitch account to download." · "This VOD expired N days ago." · "Couldn't fine-tune sync (no shared audio) — using timestamp sync; nudge manually if needed."

---

## 9. Distribution, Signing, Auto-Update

**Build with Tauri 2 + `tauri-action` in GitHub Actions.** Host updates on **GitHub Releases** (free; move to Cloudflare R2 + Worker only if the repo must be private or you want a custom domain). Tauri's built-in updater uses a separate **Ed25519** key (`tauri signer generate`) — back it up immediately; losing it breaks the update channel forever.

**Windows signing — the load-bearing decision (verified 2026):** Azure **Artifact Signing** (formerly Trusted Signing), $9.99/mo (~$120/yr), is the cheapest legit path *but* Public Trust is available to **individuals only in US/Canada** — **EU individuals are excluded; EU orgs qualify.** The owner is Sweden-based, so:
- **If they register a business** (Swedish *enskild firma* — cheap, ~1 day, or AB): use **Azure Artifact Signing** at $9.99/mo via Tauri `signCommand: "trusted-signing-cli -e https://weu.codesigning.azure.net -a <acct> -c <profile> %1"` with an Entra service-principal. Microsoft-validated identity builds SmartScreen reputation faster than a fresh cert. Timestamping mandatory (certs rotate ~3 days).
- **If staying a pure individual:** buy a cheap **individual OV cert** (~$200/yr, Certum/SSL.com support EU individuals). **Do NOT pay the EV premium** — since March 2024, EV no longer grants instant SmartScreen trust; both OV and EV build reputation organically.
- **Interim:** ship **unsigned** to the 3–5 trusted editors with a one-time "More info → Run anyway" note. Free, ugly, fine for a private group.

**macOS (when it ships):** $99/yr Apple Developer Program → Developer ID signing (hardened runtime) + **notarytool** notarization + staple. No cheaper way past Gatekeeper (Sequoia removed the right-click-Open bypass). Tauri does this in CI via Apple env vars.

**Toolchain bundling:** **ffmpeg bundled** (stable). **yt-dlp download-on-first-run** to `%LOCALAPPDATA%/LivestreamSync/Tools/`, pinned by SHA-256 in a hosted `tools-manifest.json`, with an in-app "Update tools" button. This keeps the signed installer tiny, lets you push a new yt-dlp **within minutes** when Twitch breaks it *without re-signing/re-releasing the app*, and (on macOS) keeps the frequently-changing binary outside the notarized `.app` so it never breaks notarization.

**Net cost (polished):** ~$120/yr Win (Artifact Signing, needs a business) **or** ~$200/yr (individual OV) + $99/yr macOS.

---

## 10. Good-Citizen / ToS Guardrails

This is legitimate internal creator tooling on the team's own/collab content — the low-risk scenario Twitch's anti-scraping rules aren't aimed at. Be a good citizen, not hidden:

- **Use official Helix** (via the Worker) for the verification path; prefer it over hammering gql. Honor `Ratelimit-Reset` on 429; serialize per-job; concurrency ≤5.
- **Never bypass access control.** Sub-only uses the editor's *own* entitlement (device-code/Firefox cookies); fail closed if unsubscribed. No DRM/entitlement bypass shipped (avoids ToS §9(vi)/(xv) + DMCA 1201).
- **24h metadata cache cap** (Developer Services Agreement): stamp cached VOD metadata with a 24h TTL, re-query after, purge on 404/deleted. Persist only the team's own downloaded *video files* (their content), never a permanent Twitch-metadata DB.
- **No raw-VOD redistribution.** Downloads stay local; any future sharing limited to the trusted team and edited deliverables.
- **One-time in-app rights acknowledgement** (blocking on first run): "you confirm you have rights/permission to edit this content; clips stay local; sub-only uses your own login; you're responsible for clearing music/game/third-party content you publish."
- Keep GraphQL/chat-co-mention features behind an **"experimental"** flag, isolated so a Twitch change never blocks the core Helix path.
- Frame the 7/14/60-day expiry as the legitimate reason to capture the team's own content promptly.

---

## 11. Phased Build Roadmap

**v0 — Headless engine (CLI).** *~1–1.5 wks.*
Scope: handle→VOD discovery (yt-dlp `-J` GraphQL primary), containment matcher, **PDT-based sync (Layer 1)**, padded `--download-sections` download, edge-case classification. Deliverable: `livestreamsync <anchor-url> <start> <end> --roster file.json` → folder of aligned clips + a `sync.json`. This is the proven manual workflow, automated. *De-risks the whole product.*

**v1 — GUI MVP.** *~2–3 wks.*
Scope: Tauri 2 shell, sidecar bundling (ffmpeg) + yt-dlp first-run download, screens 1–3 (New Job → Auto-detect roster → **Sync Preview**) + live download progress. JSON-progress bars. Roster presets + manual add. Friendly error states. Deliverable: usable app for the editors; **no signing yet** (run-anyway note).

**v2 — Export + smart roster + audio fine-sync.** *~2.5–3.5 wks.*
Scope: **FCP7-XML export** (Premiere+Resolve) + Resolve multicam script; **Team-membership auto-expand** + (flagged) chat co-mention suggestions; **Layer 2 GCC-PHAT audio fine-sync** with confidence + manual nudge; **device-code sub-only auth** + Firefox fallback + secure token storage; Cloudflare Worker fallback deployed.

**v3 — Polish, signing, updates.** *~1–2 wks + business-reg lead time.*
Scope: Windows signing (Artifact Signing or OV), Ed25519 updater + `tauri-action` CI, tools-manifest auto-update, expiry hints, onboarding. macOS (signing + notarize) deferrable to a follow-on milestone.

*Total to a signed Windows v3: ~7–10 focused weeks for one developer.*

---

## 12. Open Decisions for the Product Owner

1. **Business registration?** This single answer picks the Windows signing path: register a Swedish *enskild firma*/AB → **Azure Artifact Signing $9.99/mo**; stay an individual → **~$200/yr OV cert**. (EU individuals are excluded from Artifact Signing — confirmed.)
2. **Sub-only auth model:** one shared "editor" Twitch login for the whole team, or each editor connects their own account? Decides centralized vs per-desktop token/cookie storage and whether `needs-auth` POVs can be auto-downloaded.
3. **Experimental GraphQL features (chat co-mention, VOD chapters):** ship them (powerful, surfaces *unlisted* collaborators) or stay strictly on documented Helix for ToS comfort? They'd be flagged + always confirmed by the deterministic test either way.
4. **Worker fallback:** auto-invoked on GraphQL failure (seamless) or a manual "verify against official API" button (less infra to babysit)?
5. **Partial coverage** (a friend went live mid-window): auto-select with a trimmed range + "partial" badge (recommended), or prompt the editor each time?
6. **macOS timing:** is Apple Silicon-only acceptable, or must it be a universal (Intel+ARM) build? Affects the per-platform binary matrix; deferrable since macOS is "planned."
7. **YouTube clip codec:** auto-transcode YouTube's VP9/AV1 to an edit-friendly **ProRes 422 HQ / DNxHR** by default (smooth scrubbing in Premiere/Resolve, larger files), or keep the **original VP9/AV1** (smaller, but choppy to edit)? Twitch H.264 is unaffected either way.

**Recommendation, in one line:** Build it on **Tauri 2** with a **GraphQL-via-yt-dlp primary + Helix-Worker fallback** discovery engine, **PDT wall-clock sync** as the always-on backbone with **optional GCC-PHAT audio fine-sync**, a **hand-rolled FCP7-XML** export (plus Resolve multicam), **device-code sub-only auth**, **yt-dlp download-on-first-run**, and — if the owner registers a Swedish business — **Azure Artifact Signing** for the cheapest legit Windows distribution.

**Uncertainties flagged inline:** (1) whether PDT appears on *every* Twitch VOD segment vs only at discontinuities — pull one live `index-dvr.m3u8` to confirm interpolation granularity before finalizing Layer 1 code; (2) whether Disconnect-Protection backup-image spans appear as real-duration continuous-PDT segments in the *downloadable* archive — one empirical test on a known-disconnect VOD; (3) device-code token longevity when used as the gql `auth-token` for VOD playback (docs say ~4h access_token, but session tokens often last far longer) — test against a real sub-only VOD; (4) exact confidence-threshold calibration for GCC-PHAT on OfflineTV-style content needs a few real multi-POV samples.

Key files/artifacts this design implies (all to be created in the project; none exist yet): the Tauri app, the `src/index.js` Worker, the `tools-manifest.json`, and the xmeml generator — code skeletons for each are inline above.