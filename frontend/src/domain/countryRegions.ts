export interface CountryRegion {
  id: string;
  label: string;
  minIndex: number;
  maxIndex: number;
}

export const COUNTRY_REGIONS: readonly CountryRegion[] = [
  { id: "europe", label: "Europe", minIndex: 11, maxIndex: 26 },
  { id: "asia", label: "Asia", minIndex: 40, maxIndex: 54 },
  { id: "africa", label: "Africa", minIndex: 27, maxIndex: 39 },
  { id: "north-america", label: "North America", minIndex: 5, maxIndex: 10 },
  { id: "south-america", label: "South America", minIndex: 0, maxIndex: 4 },
  { id: "oceania", label: "Oceania", minIndex: 55, maxIndex: 57 },
];

export function countryBelongsToRegion(
  countryIndex: number,
  region: CountryRegion,
): boolean {
  return countryIndex >= region.minIndex && countryIndex <= region.maxIndex;
}
