// Provider abstraction: Twitch and YouTube are interchangeable behind this interface.
// Everything downstream (matching, sync preview, download, export) is platform-agnostic.

import type { Tools } from './tools.js'
import type { AbsWindow, AnchorRef, Platform, POVStatus, ResolvedSegment } from './types.js'
import { parseStreamUrl } from './validate.js'
import { TwitchProvider } from './twitch.js'
import { YouTubeProvider } from './youtube.js'

export interface ProviderContext {
  tools: Tools
  log?: (msg: string) => void
}

export interface POVResolution {
  status: POVStatus
  reason?: string
  displayName?: string
  avatarUrl?: string
  segment?: ResolvedSegment
}

export interface Provider {
  readonly platform: Platform
  getAnchorInfo(vodId: string): Promise<AnchorRef>
  getUserMeta(handle: string): Promise<{ displayName: string; avatarUrl?: string } | null>
  resolveWindow(handle: string, win: AbsWindow): Promise<POVResolution>
}

export type ProviderMap = Record<Platform, Provider>

export function makeProviders(ctx: ProviderContext): ProviderMap {
  return {
    twitch: new TwitchProvider(ctx),
    youtube: new YouTubeProvider(ctx),
  }
}

/** Parse an anchor URL and fetch its VOD info via the matching provider. */
export async function resolveAnchor(url: string, providers: ProviderMap): Promise<AnchorRef> {
  const parsed = parseStreamUrl(url)
  if (parsed.kind !== 'vod') {
    throw new Error('The anchor must be a specific VOD link, not a channel.')
  }
  return providers[parsed.platform].getAnchorInfo(parsed.id)
}
