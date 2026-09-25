import type { GlobalHistoryPoint } from '../api/types.ts'

export function observedDays(history: readonly GlobalHistoryPoint[]): number[] {
  return history.map((point) => point.day)
}

export function replayDay(days: readonly number[], preferredDay: number | null): number | null {
  return preferredDay !== null && days.includes(preferredDay) ? preferredDay : days.at(-1) ?? null
}

export function replayIndex(days: readonly number[], day: number | null): number {
  return day === null ? -1 : days.indexOf(day)
}

export function adjacentDay(days: readonly number[], day: number | null, direction: -1 | 1): number | null {
  const index = replayIndex(days, day)
  return index >= 0 ? days[index + direction] ?? null : null
}

export function dayAtSliderIndex(days: readonly number[], index: number): number | null {
  return Number.isInteger(index) ? days[index] ?? null : null
}
