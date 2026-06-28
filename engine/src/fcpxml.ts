// Pre-synced timeline export as FCP7 XML (xmeml v5) — the format both Premiere Pro
// and DaVinci Resolve import with each clip kept on its own track at the right offset.

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
  // C:\dir\file.mp4 -> file://localhost/C:/dir/file.mp4 (spaces/percent-encoded)
  const fwd = absPath.replace(/\\/g, '/')
  const withSlash = fwd.startsWith('/') ? fwd : `/${fwd}`
  return 'file://localhost' + encodeURI(withSlash)
}

function rateBlock(fps: number, ntsc: boolean): string {
  return `<rate><timebase>${fps}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
}

/** Build the xmeml document. Returns an XML string. */
export function buildFcpXml(opts: FcpExportOptions): string {
  const { fps, ntsc, width, height, pad } = opts
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

  const fileDef = (c: Placed): string =>
    `<file id="${c.fileId}"><name>${xmlEscape(c.name)}</name>` +
    `<pathurl>${pathUrl(c.file)}</pathurl>${rate}` +
    `<duration>${c.durFrames}</duration>` +
    `<media><video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></video>` +
    `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media></file>`

  const videoTracks = computed
    .map((c) => {
      const vId = `clipitem-v-${c.idx + 1}`
      const aId = `clipitem-a-${c.idx + 1}`
      const end = c.startFrame + c.durFrames
      return (
        `<track>` +
        `<clipitem id="${vId}"><name>${xmlEscape(c.name)}</name>${rate}` +
        `<start>${c.startFrame}</start><end>${end}</end><in>0</in><out>${c.durFrames}</out>` +
        fileDef(c) +
        `<link><linkclipref>${vId}</linkclipref><mediatype>video</mediatype><trackindex>${c.idx + 1}</trackindex></link>` +
        `<link><linkclipref>${aId}</linkclipref><mediatype>audio</mediatype><trackindex>${c.idx + 1}</trackindex></link>` +
        `</clipitem></track>`
      )
    })
    .join('')

  const audioTracks = computed
    .map((c) => {
      const vId = `clipitem-v-${c.idx + 1}`
      const aId = `clipitem-a-${c.idx + 1}`
      const end = c.startFrame + c.durFrames
      return (
        `<track>` +
        `<clipitem id="${aId}"><name>${xmlEscape(c.name)}</name>${rate}` +
        `<start>${c.startFrame}</start><end>${end}</end><in>0</in><out>${c.durFrames}</out>` +
        `<file id="${c.fileId}"/>` +
        `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` +
        `<link><linkclipref>${vId}</linkclipref><mediatype>video</mediatype><trackindex>${c.idx + 1}</trackindex></link>` +
        `<link><linkclipref>${aId}</linkclipref><mediatype>audio</mediatype><trackindex>${c.idx + 1}</trackindex></link>` +
        `</clipitem></track>`
      )
    })
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n` +
    `<xmeml version="5">\n` +
    `<sequence id="livestreamsync-seq">` +
    `<name>${xmlEscape(opts.sequenceName)}</name>` +
    `<duration>${seqDuration}</duration>${rate}` +
    `<media>` +
    `<video><format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></format>${videoTracks}</video>` +
    `<audio>${audioTracks}</audio>` +
    `</media>` +
    `</sequence>\n</xmeml>\n`
  )
}
