import { useSyncExternalStore } from 'react'
import { liveGameStore } from '../api/liveStore.ts'

export function useLiveGame() {
  return useSyncExternalStore(liveGameStore.subscribe, liveGameStore.getSnapshot, liveGameStore.getSnapshot)
}
