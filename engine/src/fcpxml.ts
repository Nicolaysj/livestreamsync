// Pre-synced timeline export as FCP7 XML (xmeml v5) — the format both Premiere Pro
// and DaVinci Resolve import with each clip kept on its own track at the right offset.

import { clampFinite } from './validate.js'

export interface FcpClipInput {
  name: string
  file: string // absolute path to the downloaded clip
  vodStartMs: number // wall-clock of the clip's VOD position 0
  offsetSec: number // window start inside the VOD
  windowLenSec: number
}

export interface FcpExportOptions {
  sequenceName: string
  fps: number // e.g. 60
  ntsc: boolean // true only for 29.97/59.94
  width: number
  height: number
  pad: number // padding seconds used during download
  clips: FcpClipInput[]
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pathUrl(absPath: string): string {
  // C:\dir\file.mp4 -> file://localhost/C:/dir/file.mp4. encodeURI leaves '#' and
  // '%' alone, so a folder like "#raid night" or a name with '%' yields a URL whose
  // tail is parsed as a fragment — Premiere/Resolve then show every clip as media
  // offline. Encode each segment fully and restore the drive-letter colon.
  const fwd = absPath.replace(/\\/g, '/')
  const withSlash = fwd.startsWith('/') ? fwd : `/${fwd}`
  const encoded = withSlash
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':'))
    .join('/')
  return 'file://localhost' + encoded
}

function rateBlock(fps: number, ntsc: boolean): string {
  return `<rate><timebase>${fps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
}

// FCP7 label2 colour names as written by Premiere's own xmeml exporter. Each POV
// gets one colour (cycled) on both its video and audio clipitems, so multi-POV
// timelines are tellable-apart at a glance after import.
const LABEL_PALETTE = ['Iris', 'Rose', 'Mango', 'Forest', 'Caribbean', 'Lavender', 'Violet', 'Cerulean'] as const

function labelBlock(idx: number): string {
  return `<labels><label2>${LABEL_PALETTE[idx % LABEL_PALETTE.length]}</label2></labels>`
}

/** Build the xmeml document. Returns an XML string. */
export function buildFcpXml(opts: FcpExportOptions): string {
  const { fps, ntsc, width, height } = opts
  // Must mirror the clamp in downloadSegment: the export math assumes the file
  // really starts at offset-pad, so a pad the download refused (e.g. 90 → 60,
  // or negative) would shift every clip on the timeline.
  const pad = clampFinite(opts.pad, 0, 60)
  const clips = opts.clips.filter((c) => c.windowLenSec > 0)
  if (clips.length === 0) throw new Error('No clips to export.')

  type Placed = FcpClipInput & { startFrame: number; durFrames: number; fileId: string; idx: number }
  const computed: Placed[] = clips.map((c, idx) => {
    const sliceStartVod = Math.max(0, c.offsetSec - pad)
    const endVod = c.offsetSec + c.windowLenSec + pad
    const fileLenSec = Math.max(0, endVod - sliceStartVod)
    const clipStartMs = c.vodStartMs + sliceStartVod * 1000
    return { ...c, startFrame: 0, durFrames: Math.round(fileLenSec * fps), clipStartMs, fileId: `file-${idx + 1}`, idx } as Placed & { clipStartMs: number }
  }) as (Placed & { clipStartMs: number })[]

  const seqZero = Math.min(...(computed as (Placed & { clipStartMs: number })[]).map((c) => c.clipStartMs))
  for (const c of computed as (Placed & { clipStartMs: number })[]) {
    c.startFrame = Math.round(((c.clipStartMs - seqZero) / 1000) * fps)
  }
  const seqDuration = Math.max(...computed.map((c) => c.startFrame + c.durFrames))

  const rate = rateBlock(fps, ntsc)

  // Without an explicit <pixelaspectratio>, Premiere falls back to its DV-preset
  // guess (users saw 1.0940 D1/DV PAL) instead of assuming square pixels.
  const videoChars =
    `<samplecharacteristics>${rate}<width>${width}</width><height>${height}</height>` +
    `<anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio>` +
    `<fielddominance>none</fielddominance></samplecharacteristics>`

  const fileDef = (c: Placed): string =>
    `<file id="${c.fileId}"><name>${xmlEscape(c.name)}</name>` +
    `<pathurl>${pathUrl(c.file)}</pathurl>${rate}` +
    `<duration>${c.durFrames}</duration>` +
    `<media><video>${videoChars}</video>` +
    `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media></file>`

  // FCP7 link semantics (Apple DTD): a valid link is linkclipref OR the full
  // tuple mediatype+trackindex+clipindex — our old half-tuple (no clipindex)
  // was discarded by Premiere, importing clips unlinked. Premiere's own exports
  // repeat the complete link array (self-link included) in every linked
  // clipitem, with stereo audio exploded into one clipitem per channel.
  const vId = (i: number) => `clipitem-v-${i + 1}`
  const aId = (i: number, ch: 1 | 2) => `clipitem-a${ch}-${i + 1}`
  const linkArray = (c: Placed): string =>
    `<link><linkclipref>${vId(c.idx)}</linkclipref><mediatype>video</mediatype><trackindex>${c.idx + 1}</trackindex><clipindex>1</clipindex></link>` +
    `<link><linkclipref>${aId(c.idx, 1)}</linkclipref><mediatype>audio</mediatype><trackindex>${2 * c.idx + 1}</trackindex><clipindex>1</clipindex><groupindex>1</groupindex></link>` +
    `<link><linkclipref>${aId(c.idx, 2)}</linkclipref><mediatype>audio</mediatype><trackindex>${2 * c.idx + 2}</trackindex><clipindex>1</clipindex><groupindex>1</groupindex></link>`

  const videoTracks = computed
    .map((c) => {
      const end = c.startFrame + c.durFrames
      return (
        `<track>` +
        `<clipitem id="${vId(c.idx)}"><name>${xmlEscape(c.name)}</name>${rate}` +
        `<start>${c.startFrame}</start><end>${end}</end><in>0</in><out>${c.durFrames}</out>` +
        labelBlock(c.idx) +
        fileDef(c) +
        linkArray(c) +
        `</clipitem></track>`
      )
    })
    .join('')

  // Stereo = two exploded audio clipitems (source channel 1/2 on adjacent
  // tracks), mirroring Premiere's native representation so imports link + pan
  // correctly. The premiere* attributes are Premiere-isms other NLEs ignore.
  const audioTracks = computed
    .map((c) => {
      const end = c.startFrame + c.durFrames
      const channelItem = (ch: 1 | 2): string =>
        `<track currentExplodedTrackIndex="${ch - 1}" totalExplodedTrackCount="2" premiereTrackType="Stereo">` +
        `<outputchannelindex>${ch}</outputchannelindex>` +
        `<clipitem id="${aId(c.idx, ch)}" premiereChannelType="stereo"><name>${xmlEscape(c.name)}</name>${rate}` +
        `<start>${c.startFrame}</start><end>${end}</end><in>0</in><out>${c.durFrames}</out>` +
        labelBlock(c.idx) +
        `<file id="${c.fileId}"/>` +
        `<sourcetrack><mediatype>audio</mediatype><trackindex>${ch}</trackindex></sourcetrack>` +
        linkArray(c) +
        `</clipitem></track>`
      return channelItem(1) + channelItem(2)
    })
    .join('')

  // Every full-coverage clip's content starts pad seconds before the requested
  // window, so the moment all POVs are wall-clock aligned sits pad*fps frames
  // into the timeline. Premiere imports sequence-level markers (clip-level ones
  // it ignores), so one marker across all tracks marks the sync point.
  const syncMarker =
    `<marker><name>Sync point</name>` +
    `<comment>All POVs are wall-clock aligned from here (requested window start).</comment>` +
    `<in>${Math.round(pad * fps)}</in><out>-1</out></marker>`

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n` +
    `<xmeml version="5">\n` +
    `<sequence id="livestreamsync-seq" explodedTracks="true">` +
    `<name>${xmlEscape(opts.sequenceName)}</name>` +
    `<duration>${seqDuration}</duration>${rate}` +
    `<media>` +
    `<video><format>${videoChars}</format>${videoTracks}</video>` +
    `<audio>${audioTracks}</audio>` +
    `</media>` +
    syncMarker +
    `</sequence>\n</xmeml>\n`
  )
}
