import type { CountryHistoryPoint, GlobalHistoryPoint } from '../api/types.ts'

export interface ChartSnapshot {
  day: number
  gameDate: string
  healthy: number
  infected: number
  dead: number
  zombies: number
  cureProgress: number
}

export function mapGlobalHistoryToChart(history: readonly GlobalHistoryPoint[]): ChartSnapshot[] {
  return history.map((point) => ({
    day: point.day,
    gameDate: point.gameDate,
    healthy: point.healthy,
    infected: point.infected,
    dead: point.dead,
    zombies: point.zombies,
    cureProgress: point.cureProgress,
  }))
}

export interface CountryChartSnapshot {
  day: number
  gameDate: string
  healthy: number
  infected: number
  dead: number
  zombies: number
}

export function mapCountryHistoryToChart(history: readonly CountryHistoryPoint[]): CountryChartSnapshot[] {
  return history.map((point) => ({
    day: point.day,
    gameDate: point.gameDate,
    healthy: point.healthyPopulation,
    infected: point.infected,
    dead: point.deadPopulation,
    zombies: point.zombies,
  }))
}
