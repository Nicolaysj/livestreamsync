import type { LivestreamSyncApi } from '../shared/ipc'

declare global {
  interface Window {
    livestreamsync?: LivestreamSyncApi
  }
}

export {}
