import type { SessionCountry } from '../api/types.ts'

export function formatCountryName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export function resolveSessionCountry(
  countries: readonly SessionCountry[],
  preferredId: string | null,
): string | null {
  if (preferredId && countries.some((country) => country.id === preferredId)) return preferredId
  return countries[0]?.id ?? null
}
