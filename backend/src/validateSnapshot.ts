import type { CountrySnapshot, GameSnapshot } from './types.js';

const populationFields = [
  'currentPopulation',
  'originalPopulation',
  'healthyPopulation',
  'deadPopulation',
  'infected',
  'zombies',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validGameDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotValidationError';
  }
}

export function validateSnapshot(value: unknown): GameSnapshot {
  if (!isRecord(value)) {
    throw new SnapshotValidationError('snapshot must be a JSON object');
  }
  if (!validTimestamp(value.capturedAt)) {
    throw new SnapshotValidationError('capturedAt must be a parseable ISO 8601 timestamp');
  }
  if (!nonNegativeSafeInteger(value.diseaseTurn)) {
    throw new SnapshotValidationError('diseaseTurn must be a non-negative safe integer');
  }
  if (!nonNegativeSafeInteger(value.eventTurn)) {
    throw new SnapshotValidationError('eventTurn must be a non-negative safe integer');
  }
  if (!nonNegativeSafeInteger(value.day)) {
    throw new SnapshotValidationError('day must be a non-negative safe integer');
  }
  if (!validGameDate(value.gameDate)) {
    throw new SnapshotValidationError('gameDate must be a valid yyyy-MM-dd date');
  }
  if (typeof value.cureProgress !== 'number'
    || !Number.isFinite(value.cureProgress)
    || value.cureProgress < 0
    || value.cureProgress > 100) {
    throw new SnapshotValidationError('cureProgress must be finite and between 0 and 100');
  }
  if (!Array.isArray(value.countries) || value.countries.length === 0) {
    throw new SnapshotValidationError('countries must be a non-empty array');
  }

  const ids = new Set<string>();
  const countries: CountrySnapshot[] = value.countries.map((raw, position) => {
    if (!isRecord(raw)) {
      throw new SnapshotValidationError(`countries[${position}] must be an object`);
    }
    if (!nonNegativeSafeInteger(raw.index)) {
      throw new SnapshotValidationError(`countries[${position}].index must be a non-negative safe integer`);
    }
    if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
      throw new SnapshotValidationError(`countries[${position}].id must be a non-empty string`);
    }
    if (ids.has(raw.id)) {
      throw new SnapshotValidationError(`duplicate country id: ${raw.id}`);
    }
    ids.add(raw.id);

    for (const field of populationFields) {
      if (!nonNegativeSafeInteger(raw[field])) {
        throw new SnapshotValidationError(`countries[${position}].${field} must be a non-negative safe integer`);
      }
    }

    return {
      index: raw.index,
      id: raw.id,
      currentPopulation: raw.currentPopulation as number,
      originalPopulation: raw.originalPopulation as number,
      healthyPopulation: raw.healthyPopulation as number,
      deadPopulation: raw.deadPopulation as number,
      infected: raw.infected as number,
      zombies: raw.zombies as number,
    };
  });

  return {
    capturedAt: value.capturedAt,
    diseaseTurn: value.diseaseTurn,
    eventTurn: value.eventTurn,
    day: value.day,
    gameDate: value.gameDate,
    cureProgress: value.cureProgress,
    countries,
  };
}
