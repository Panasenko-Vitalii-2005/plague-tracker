import type { CountryHistoryPoint, CountrySnapshot, GlobalHistoryPoint } from '../api/types.ts'
import type { LiveConnectionState } from '../api/liveStore.ts'
import type { GlobalMetrics } from './metrics.ts'

type CountryPopulation = Pick<CountrySnapshot | CountryHistoryPoint,
  'healthyPopulation' | 'infected' | 'deadPopulation' | 'zombies' | 'originalPopulation' | 'currentPopulation'>

export function percentageOf(value: number, originalPopulation: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(originalPopulation) || originalPopulation <= 0) return 0
  return value / originalPopulation * 100
}

export function globalPercentages(metrics: GlobalMetrics | GlobalHistoryPoint) {
  return {
    healthy: percentageOf(metrics.healthy, metrics.originalPopulation),
    infected: percentageOf(metrics.infected, metrics.originalPopulation),
    dead: percentageOf(metrics.dead, metrics.originalPopulation),
    zombies: percentageOf(metrics.zombies, metrics.originalPopulation),
  }
}

export function countryOverview(country: CountryPopulation) {
  return {
    healthy: country.healthyPopulation,
    infected: country.infected,
    dead: country.deadPopulation,
    zombies: country.zombies,
    originalPopulation: country.originalPopulation,
    currentPopulation: country.currentPopulation,
    healthyPercent: percentageOf(country.healthyPopulation, country.originalPopulation),
    infectedPercent: percentageOf(country.infected, country.originalPopulation),
    deadPercent: percentageOf(country.deadPopulation, country.originalPopulation),
  }
}

export function shortSessionId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : '—'
}

export function liveStatus(state: LiveConnectionState): {
  label: string
  tone: 'live' | 'waiting' | 'offline'
  description: string
} {
  switch (state) {
    case 'live': return { label: 'Live', tone: 'live', description: 'Game data is updating.' }
    case 'waiting-for-game': return { label: 'Waiting for game', tone: 'waiting',
      description: 'Backend is ready. Open a game to start live tracking.' }
    case 'connecting': return { label: 'Connecting', tone: 'waiting',
      description: 'Connecting to live data…' }
    case 'reconnecting': return { label: 'Reconnecting', tone: 'offline',
      description: 'Connection lost. Retrying automatically…' }
    case 'error': return { label: 'Backend unavailable', tone: 'offline',
      description: 'Live data could not be read. Please check the backend.' }
  }
}
