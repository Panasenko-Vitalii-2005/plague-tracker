import { useEffect, useMemo, useState } from 'react'
import type { SessionHistoryResponse } from '../api/types.ts'
import { adjacentDay, dayAtSliderIndex, observedDays, replayDay, replayIndex } from '../domain/replay.ts'
import { useHistoricalSnapshot, type Resource } from './useHistory.ts'
import type { HistoricalSnapshot } from '../api/types.ts'

export interface HistoricalReplay {
  days: number[]
  day: number | null
  index: number
  snapshot: Resource<HistoricalSnapshot>
  isPlaying: boolean
  selectIndex(index: number): void
  previous(): void
  next(): void
  togglePlay(): void
  reset(): void
}

export function useReplay(sessionId: string, history: Resource<SessionHistoryResponse>): HistoricalReplay {
  const [selection, setSelection] = useState<{ sessionId: string; day: number } | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const points = history.status === 'success' ? history.data.history : null
  const days = useMemo(() => points ? observedDays(points) : [], [points])
  const preferredDay = selection?.sessionId === sessionId ? selection.day : null
  const day = replayDay(days, preferredDay)
  const index = replayIndex(days, day)
  const snapshot = useHistoricalSnapshot(sessionId || null, day)

  useEffect(() => {
    if (!isPlaying) return
    if (index < 0 || index >= days.length - 1) return
    const timer = window.setTimeout(() => {
      const next = adjacentDay(days, day, 1)
      if (next !== null) {
        setSelection({ sessionId, day: next })
        if (next === days.at(-1)) setIsPlaying(false)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [isPlaying, index, day, sessionId, days])

  const select = (nextDay: number | null) => {
    setIsPlaying(false)
    if (nextDay !== null) setSelection({ sessionId, day: nextDay })
  }
  return {
    days, day, index, snapshot, isPlaying,
    selectIndex: (nextIndex) => select(dayAtSliderIndex(days, nextIndex)),
    previous: () => select(adjacentDay(days, day, -1)),
    next: () => select(adjacentDay(days, day, 1)),
    togglePlay: () => {
      if (isPlaying) { setIsPlaying(false); return }
      if (days.length < 2) return
      if (index >= days.length - 1) setSelection({ sessionId, day: days[0]! })
      setIsPlaying(true)
    },
    reset: () => { setIsPlaying(false); setSelection(null) },
  }
}
