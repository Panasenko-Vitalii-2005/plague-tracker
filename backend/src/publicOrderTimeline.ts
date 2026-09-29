import type {
  GameSnapshot,
  PublicOrderEvent,
  PublicOrderStatus,
} from "./types.js";

const PUBLIC_ORDER_STATUSES: readonly PublicOrderStatus[] = [
  "normal",
  "general_disorder",
  "mass_disorder",
  "near_anarchy",
  "anarchy",
];

export function publicOrderStatus(
  value: number | null,
): PublicOrderStatus | null {
  if (value === null) return null;

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("publicOrder must be between 0 and 1");
  }

  if (value >= 0.9) return "normal";
  if (value >= 0.6) return "general_disorder";
  if (value >= 0.3) return "mass_disorder";
  if (value > 0) return "near_anarchy";
  return "anarchy";
}

export function publicOrderStatusIndex(status: PublicOrderStatus): number {
  return PUBLIC_ORDER_STATUSES.indexOf(status);
}

export function observedPublicOrderEvents(
  previous: GameSnapshot | null,
  current: GameSnapshot,
  compareCountries: boolean,
): PublicOrderEvent[] {
  const events =
    previous?.publicOrderEvents.map((event) => ({ ...event })) ?? [];

  if (!previous || !compareCountries) return events;

  const previousById = new Map(
    previous.countries.map((country) => [country.id, country]),
  );

  for (const country of current.countries) {
    const before = previousById.get(country.id);
    if (!before) continue;
    if (country.publicOrder === null) continue;

    const fromStatus = publicOrderStatus(before.publicOrder);
    const toStatus = publicOrderStatus(country.publicOrder);

    if (fromStatus === null || toStatus === null || fromStatus === toStatus) {
      continue;
    }

    events.push({
      countryId: country.id,
      turn: current.day,
      fromStatus,
      toStatus,
      publicOrder: country.publicOrder,
      direction:
        publicOrderStatusIndex(toStatus) > publicOrderStatusIndex(fromStatus)
          ? "deteriorated"
          : "improved",
    });
  }

  return events;
}
