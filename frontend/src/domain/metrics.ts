import type { CountrySnapshot } from '../api/types.ts'

export interface GlobalMetrics {
  healthy: number
  infected: number
  dead: number
  zombies: number
  originalPopulation: number
}

export function aggregateCountries(countries: readonly CountrySnapshot[]): GlobalMetrics {
  return countries.reduce<GlobalMetrics>((total, country) => ({
    healthy: total.healthy + country.healthyPopulation,
    infected: total.infected + country.infected,
    dead: total.dead + country.deadPopulation,
    zombies: total.zombies + country.zombies,
    originalPopulation: total.originalPopulation + country.originalPopulation,
  }), { healthy: 0, infected: 0, dead: 0, zombies: 0, originalPopulation: 0 })
}
