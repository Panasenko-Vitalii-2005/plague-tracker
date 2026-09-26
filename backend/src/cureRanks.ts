import type { CountrySnapshot } from './types.js';

export function withCureRanks(countries: CountrySnapshot[]): CountrySnapshot[] {
  if (countries.some((country) => country.cureResearch === null)) {
    // An unavailable contribution could outrank any observed country.
    return countries.map((country) => ({ ...country, cureResearch: country.cureResearch
      ? { ...country.cureResearch, rank: null } : null }));
  }
  // The game sorts descending but its List.Sort tie order is unspecified.
  // Country index supplies a deterministic tie order for persisted/API data.
  const contributors = countries.filter((country) => (country.cureResearch?.funding ?? 0) > 0)
    .sort((left, right) => right.cureResearch!.funding - left.cureResearch!.funding
      || left.index - right.index);
  const ranks = new Map(contributors.map((country, position) => [country.id, position + 1]));
  return countries.map((country) => ({ ...country,
    cureResearch: country.cureResearch ? { ...country.cureResearch,
      rank: ranks.get(country.id) ?? null } : null }));
}
