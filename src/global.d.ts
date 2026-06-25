import type { PovsyncApi } from '../shared/ipc'

declare global {
  interface Window {
    povsync?: PovsyncApi
  }
}

export {}
