import type { CountrySnapshot } from '../api/types.ts'

export interface CountryStatusSlice {
  name: 'Healthy' | 'Infected' | 'Dead'
  value: number
}

// Zombies are a separate recorded counter. The collector contract does not
// establish that zombies are disjoint from active infected, so they cannot be
// added as a fourth slice without risking double counting.
export function countryStatusComposition(country: Pick<CountrySnapshot,
  'healthyPopulation' | 'infected' | 'deadPopulation'>) {
  const slices: CountryStatusSlice[] = [
    { name: 'Healthy', value: country.healthyPopulation },
    { name: 'Infected', value: country.infected },
    { name: 'Dead', value: country.deadPopulation },
  ]
  return { slices, total: slices.reduce((sum, slice) => sum + slice.value, 0) }
}
