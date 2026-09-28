import type { CountrySnapshot, GameSnapshot, ZombieHordeEvent } from './types.js';
import { withCureRanks } from './cureRanks.js';

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

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

    const rawActions = raw.governmentActions === undefined ? [] : raw.governmentActions;
    if (!Array.isArray(rawActions) || rawActions.length > 1024) {
      throw new SnapshotValidationError(`countries[${position}].governmentActions must be an array of at most 1024 events`);
    }
    const governmentActions = rawActions.map((event, eventIndex) => {
      if (!isRecord(event) || typeof event.id !== 'string'
        || event.id.length > 4096 || typeof event.turn !== 'number'
        || !Number.isSafeInteger(event.turn)
        || typeof event.removed !== 'boolean') {
        throw new SnapshotValidationError(`countries[${position}].governmentActions[${eventIndex}] is invalid`);
      }
      return { id: event.id, turn: event.turn, removed: event.removed };
    });

    let cureResearch: CountrySnapshot['cureResearch'] = null;
    if (raw.cureResearch !== undefined && raw.cureResearch !== null) {
      if (!isRecord(raw.cureResearch) || !finiteNumber(raw.cureResearch.funding)
        || !finiteNumber(raw.cureResearch.allocation) || !isRecord(raw.cureResearch.flasks)
        || !nonNegativeSafeInteger(raw.cureResearch.flasks.active)
        || !nonNegativeSafeInteger(raw.cureResearch.flasks.inactive)
        || !nonNegativeSafeInteger(raw.cureResearch.flasks.destroyed)
        || (raw.cureResearch.rank !== undefined && raw.cureResearch.rank !== null
          && (!nonNegativeSafeInteger(raw.cureResearch.rank) || raw.cureResearch.rank === 0))) {
        throw new SnapshotValidationError(`countries[${position}].cureResearch is invalid`);
      }
      cureResearch = { funding: raw.cureResearch.funding, allocation: raw.cureResearch.allocation,
        rank: null, flasks: { active: raw.cureResearch.flasks.active,
          inactive: raw.cureResearch.flasks.inactive,
          destroyed: raw.cureResearch.flasks.destroyed } };
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
      governmentActions,
      cureResearch,
    };
  });

  const rawHordes = value.zombieHordeEvents === undefined ? [] : value.zombieHordeEvents;
  if (!Array.isArray(rawHordes) || rawHordes.length > 100_000) {
    throw new SnapshotValidationError('zombieHordeEvents must be an array of at most 100000 events');
  }
  const zombieHordeEvents: ZombieHordeEvent[] = rawHordes.map((raw, index) => {
    const prefix = `zombieHordeEvents[${index}]`;
    if (!isRecord(raw)) throw new SnapshotValidationError(`${prefix} must be an object`);
    for (const field of ['turn', 'eventTurn', 'diseaseId', 'zombies'] as const) {
      if (!nonNegativeSafeInteger(raw[field])) {
        throw new SnapshotValidationError(`${prefix}.${field} must be a non-negative safe integer`);
      }
    }
    for (const field of ['sourceCountryId', 'destinationCountryId'] as const) {
      if (typeof raw[field] !== 'string' || raw[field].trim().length === 0
        || raw[field].length > 4096) {
        throw new SnapshotValidationError(`${prefix}.${field} must be a non-empty string`);
      }
    }
    const turn = raw.turn as number;
    const vehicleId = raw.vehicleId === undefined ? null : raw.vehicleId;
    const arrivalTurn = raw.arrivalTurn === undefined ? null : raw.arrivalTurn;
    const arrivalEventTurn = raw.arrivalEventTurn === undefined ? null : raw.arrivalEventTurn;
    if (vehicleId !== null && !nonNegativeSafeInteger(vehicleId)) {
      throw new SnapshotValidationError(`${prefix}.vehicleId must be null or a non-negative safe integer`);
    }
    if (arrivalTurn !== null && (!nonNegativeSafeInteger(arrivalTurn) || arrivalTurn < turn)) {
      throw new SnapshotValidationError(`${prefix}.arrivalTurn must be null or at least turn`);
    }
    if (arrivalEventTurn !== null && !nonNegativeSafeInteger(arrivalEventTurn)) {
      throw new SnapshotValidationError(`${prefix}.arrivalEventTurn must be null or a non-negative safe integer`);
    }
    return {
      turn,
      eventTurn: raw.eventTurn as number,
      diseaseId: raw.diseaseId as number,
      sourceCountryId: raw.sourceCountryId as string,
      destinationCountryId: raw.destinationCountryId as string,
      zombies: raw.zombies as number,
      vehicleId: vehicleId as number | null,
      arrivalTurn: arrivalTurn as number | null,
      arrivalEventTurn: arrivalEventTurn as number | null,
    };
  });

  return {
    capturedAt: value.capturedAt,
    diseaseTurn: value.diseaseTurn,
    eventTurn: value.eventTurn,
    day: value.day,
    gameDate: value.gameDate,
    cureProgress: value.cureProgress,
    countries: withCureRanks(countries),
    zombieHordeEvents,
  };
}
