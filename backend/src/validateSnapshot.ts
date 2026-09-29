import type {
  CountryInfectionEvent,
  CountrySnapshot,
  GameMilestone,
  GameMilestoneType,
  GameSnapshot,
  InfrastructureStatus,
  PublicOrderEvent,
  PublicOrderStatus,
  ZombieHordeEvent,
} from "./types.js";
import { withCureRanks } from "./cureRanks.js";
import {
  publicOrderStatus,
  publicOrderStatusIndex,
} from "./publicOrderTimeline.js";

const populationFields = [
  "currentPopulation",
  "originalPopulation",
  "healthyPopulation",
  "deadPopulation",
  "infected",
  "zombies",
] as const;

const gameMilestoneTypes = new Set<GameMilestoneType>([
  "virus_dna_detected",
  "more_infectious_than_tb",
  "more_infectious_than_hiv",
  "disease_detected",
  "first_death",
  "more_infectious_than_common_cold",
  "worse_than_black_death",
  "worse_than_spanish_flu",
  "worse_than_smallpox",
]);
const publicOrderStatuses = new Set<PublicOrderStatus>([
  "normal",
  "general_disorder",
  "mass_disorder",
  "near_anarchy",
  "anarchy",
]);

function isGameMilestoneType(value: unknown): value is GameMilestoneType {
  return (
    typeof value === "string" &&
    gameMilestoneTypes.has(value as GameMilestoneType)
  );
}

function isPublicOrderStatus(value: unknown): value is PublicOrderStatus {
  return (
    typeof value === "string" &&
    publicOrderStatuses.has(value as PublicOrderStatus)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function infrastructureStatus(
  value: unknown,
  label: string,
): InfrastructureStatus {
  if (value === undefined || value === null) return null;
  if (value === "open" || value === "closed") return value;
  throw new SnapshotValidationError(
    `${label} must be "open", "closed", or null`,
  );
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function validGameDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

export function parsePublicOrderEvents(value: unknown): PublicOrderEvent[] {
  if (!Array.isArray(value) || value.length > 100_000) {
    throw new SnapshotValidationError(
      "publicOrderEvents must be an array of at most 100000 events",
    );
  }
  return value.map((raw, index) => {
    const prefix = `publicOrderEvents[${index}]`;
    if (!isRecord(raw))
      throw new SnapshotValidationError(`${prefix} must be an object`);
    if (
      typeof raw.countryId !== "string" ||
      raw.countryId.trim().length === 0 ||
      raw.countryId.length > 4096
    ) {
      throw new SnapshotValidationError(
        `${prefix}.countryId must be a non-empty string`,
      );
    }
    if (!nonNegativeSafeInteger(raw.turn)) {
      throw new SnapshotValidationError(
        `${prefix}.turn must be a non-negative safe integer`,
      );
    }
    if (
      !isPublicOrderStatus(raw.fromStatus) ||
      !isPublicOrderStatus(raw.toStatus) ||
      raw.fromStatus === raw.toStatus
    ) {
      throw new SnapshotValidationError(
        `${prefix} must have distinct supported statuses`,
      );
    }
    if (
      !finiteNumber(raw.publicOrder) ||
      raw.publicOrder < 0 ||
      raw.publicOrder > 1 ||
      publicOrderStatus(raw.publicOrder) !== raw.toStatus
    ) {
      throw new SnapshotValidationError(
        `${prefix}.publicOrder must match toStatus and be within 0..1`,
      );
    }
    const direction =
      publicOrderStatusIndex(raw.toStatus) >
      publicOrderStatusIndex(raw.fromStatus)
        ? "deteriorated"
        : "improved";
    if (raw.direction !== direction) {
      throw new SnapshotValidationError(
        `${prefix}.direction does not match the status transition`,
      );
    }
    return {
      countryId: raw.countryId,
      turn: raw.turn,
      fromStatus: raw.fromStatus,
      toStatus: raw.toStatus,
      publicOrder: raw.publicOrder,
      direction,
    };
  });
}

export function validateSnapshot(value: unknown): GameSnapshot {
  if (!isRecord(value)) {
    throw new SnapshotValidationError("snapshot must be a JSON object");
  }
  if (!validTimestamp(value.capturedAt)) {
    throw new SnapshotValidationError(
      "capturedAt must be a parseable ISO 8601 timestamp",
    );
  }
  if (!nonNegativeSafeInteger(value.diseaseTurn)) {
    throw new SnapshotValidationError(
      "diseaseTurn must be a non-negative safe integer",
    );
  }
  if (!nonNegativeSafeInteger(value.eventTurn)) {
    throw new SnapshotValidationError(
      "eventTurn must be a non-negative safe integer",
    );
  }
  if (!nonNegativeSafeInteger(value.day)) {
    throw new SnapshotValidationError(
      "day must be a non-negative safe integer",
    );
  }
  if (!validGameDate(value.gameDate)) {
    throw new SnapshotValidationError(
      "gameDate must be a valid yyyy-MM-dd date",
    );
  }
  if (
    typeof value.cureProgress !== "number" ||
    !Number.isFinite(value.cureProgress) ||
    value.cureProgress < 0 ||
    value.cureProgress > 100
  ) {
    throw new SnapshotValidationError(
      "cureProgress must be finite and between 0 and 100",
    );
  }
  if (!Array.isArray(value.countries) || value.countries.length === 0) {
    throw new SnapshotValidationError("countries must be a non-empty array");
  }

  const ids = new Set<string>();
  const countries: CountrySnapshot[] = value.countries.map((raw, position) => {
    if (!isRecord(raw)) {
      throw new SnapshotValidationError(
        `countries[${position}] must be an object`,
      );
    }
    if (!nonNegativeSafeInteger(raw.index)) {
      throw new SnapshotValidationError(
        `countries[${position}].index must be a non-negative safe integer`,
      );
    }
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
      throw new SnapshotValidationError(
        `countries[${position}].id must be a non-empty string`,
      );
    }
    if (ids.has(raw.id)) {
      throw new SnapshotValidationError(`duplicate country id: ${raw.id}`);
    }
    ids.add(raw.id);

    for (const field of populationFields) {
      if (!nonNegativeSafeInteger(raw[field])) {
        throw new SnapshotValidationError(
          `countries[${position}].${field} must be a non-negative safe integer`,
        );
      }
    }

    const publicOrder = raw.publicOrder === undefined ? null : raw.publicOrder;
    if (
      publicOrder !== null &&
      (!finiteNumber(publicOrder) || publicOrder < 0 || publicOrder > 1)
    ) {
      throw new SnapshotValidationError(
        `countries[${position}].publicOrder must be null or finite between 0 and 1`,
      );
    }
    const borderStatus = infrastructureStatus(
      raw.borderStatus,
      `countries[${position}].borderStatus`,
    );
    const airportStatus = infrastructureStatus(
      raw.airportStatus,
      `countries[${position}].airportStatus`,
    );
    const portStatus = infrastructureStatus(
      raw.portStatus,
      `countries[${position}].portStatus`,
    );

    const rawActions =
      raw.governmentActions === undefined ? [] : raw.governmentActions;
    if (!Array.isArray(rawActions) || rawActions.length > 1024) {
      throw new SnapshotValidationError(
        `countries[${position}].governmentActions must be an array of at most 1024 events`,
      );
    }
    const governmentActions = rawActions.map((event, eventIndex) => {
      if (
        !isRecord(event) ||
        typeof event.id !== "string" ||
        event.id.length > 4096 ||
        typeof event.turn !== "number" ||
        !Number.isSafeInteger(event.turn) ||
        typeof event.removed !== "boolean"
      ) {
        throw new SnapshotValidationError(
          `countries[${position}].governmentActions[${eventIndex}] is invalid`,
        );
      }
      return { id: event.id, turn: event.turn, removed: event.removed };
    });

    let cureResearch: CountrySnapshot["cureResearch"] = null;
    if (raw.cureResearch !== undefined && raw.cureResearch !== null) {
      if (
        !isRecord(raw.cureResearch) ||
        !finiteNumber(raw.cureResearch.funding) ||
        !finiteNumber(raw.cureResearch.allocation) ||
        !isRecord(raw.cureResearch.flasks) ||
        !nonNegativeSafeInteger(raw.cureResearch.flasks.active) ||
        !nonNegativeSafeInteger(raw.cureResearch.flasks.inactive) ||
        !nonNegativeSafeInteger(raw.cureResearch.flasks.destroyed) ||
        (raw.cureResearch.rank !== undefined &&
          raw.cureResearch.rank !== null &&
          (!nonNegativeSafeInteger(raw.cureResearch.rank) ||
            raw.cureResearch.rank === 0))
      ) {
        throw new SnapshotValidationError(
          `countries[${position}].cureResearch is invalid`,
        );
      }
      cureResearch = {
        funding: raw.cureResearch.funding,
        allocation: raw.cureResearch.allocation,
        rank: null,
        flasks: {
          active: raw.cureResearch.flasks.active,
          inactive: raw.cureResearch.flasks.inactive,
          destroyed: raw.cureResearch.flasks.destroyed,
        },
      };
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
      publicOrder,
      borderStatus,
      airportStatus,
      portStatus,
      governmentActions,
      cureResearch,
    };
  });

  const rawHordes =
    value.zombieHordeEvents === undefined ? [] : value.zombieHordeEvents;
  if (!Array.isArray(rawHordes) || rawHordes.length > 100_000) {
    throw new SnapshotValidationError(
      "zombieHordeEvents must be an array of at most 100000 events",
    );
  }
  const zombieHordeEvents: ZombieHordeEvent[] = rawHordes.map((raw, index) => {
    const prefix = `zombieHordeEvents[${index}]`;
    if (!isRecord(raw))
      throw new SnapshotValidationError(`${prefix} must be an object`);
    for (const field of [
      "turn",
      "eventTurn",
      "diseaseId",
      "zombies",
    ] as const) {
      if (!nonNegativeSafeInteger(raw[field])) {
        throw new SnapshotValidationError(
          `${prefix}.${field} must be a non-negative safe integer`,
        );
      }
    }
    for (const field of ["sourceCountryId", "destinationCountryId"] as const) {
      if (
        typeof raw[field] !== "string" ||
        raw[field].trim().length === 0 ||
        raw[field].length > 4096
      ) {
        throw new SnapshotValidationError(
          `${prefix}.${field} must be a non-empty string`,
        );
      }
    }
    const turn = raw.turn as number;
    const vehicleId = raw.vehicleId === undefined ? null : raw.vehicleId;
    const arrivalTurn = raw.arrivalTurn === undefined ? null : raw.arrivalTurn;
    const arrivalEventTurn =
      raw.arrivalEventTurn === undefined ? null : raw.arrivalEventTurn;
    if (vehicleId !== null && !nonNegativeSafeInteger(vehicleId)) {
      throw new SnapshotValidationError(
        `${prefix}.vehicleId must be null or a non-negative safe integer`,
      );
    }
    if (
      arrivalTurn !== null &&
      (!nonNegativeSafeInteger(arrivalTurn) || arrivalTurn < turn)
    ) {
      throw new SnapshotValidationError(
        `${prefix}.arrivalTurn must be null or at least turn`,
      );
    }
    if (
      arrivalEventTurn !== null &&
      !nonNegativeSafeInteger(arrivalEventTurn)
    ) {
      throw new SnapshotValidationError(
        `${prefix}.arrivalEventTurn must be null or a non-negative safe integer`,
      );
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

  const rawInfections =
    value.countryInfectionEvents === undefined
      ? []
      : value.countryInfectionEvents;
  if (!Array.isArray(rawInfections) || rawInfections.length > 100_000) {
    throw new SnapshotValidationError(
      "countryInfectionEvents must be an array of at most 100000 events",
    );
  }
  const countryInfectionEvents: CountryInfectionEvent[] = rawInfections.map(
    (raw, index) => {
      const prefix = `countryInfectionEvents[${index}]`;
      if (!isRecord(raw))
        throw new SnapshotValidationError(`${prefix} must be an object`);
      if (
        typeof raw.countryId !== "string" ||
        raw.countryId.trim().length === 0 ||
        raw.countryId.length > 4096
      ) {
        throw new SnapshotValidationError(
          `${prefix}.countryId must be a non-empty string`,
        );
      }
      for (const field of ["turn", "eventTurn", "diseaseId"] as const) {
        if (
          typeof raw[field] !== "number" ||
          !Number.isSafeInteger(raw[field])
        ) {
          throw new SnapshotValidationError(
            `${prefix}.${field} must be a safe integer`,
          );
        }
      }
      return {
        countryId: raw.countryId,
        turn: raw.turn as number,
        eventTurn: raw.eventTurn as number,
        diseaseId: raw.diseaseId as number,
      };
    },
  );

  const rawMilestones =
    value.gameMilestones === undefined ? [] : value.gameMilestones;
  if (!Array.isArray(rawMilestones) || rawMilestones.length > 100_000) {
    throw new SnapshotValidationError(
      "gameMilestones must be an array of at most 100000 events",
    );
  }
  const gameMilestones: GameMilestone[] = rawMilestones.map((raw, index) => {
    const prefix = `gameMilestones[${index}]`;
    if (!isRecord(raw))
      throw new SnapshotValidationError(`${prefix} must be an object`);
    if (!isGameMilestoneType(raw.type)) {
      throw new SnapshotValidationError(
        `${prefix}.type must be a supported game milestone type`,
      );
    }
    for (const field of ["turn", "diseaseId"] as const) {
      if (typeof raw[field] !== "number" || !Number.isSafeInteger(raw[field])) {
        throw new SnapshotValidationError(
          `${prefix}.${field} must be a safe integer`,
        );
      }
    }
    const needsCountry =
      raw.type === "disease_detected" || raw.type === "first_death";
    if (needsCountry) {
      if (
        typeof raw.countryId !== "string" ||
        raw.countryId.trim().length === 0 ||
        raw.countryId.length > 4096
      ) {
        throw new SnapshotValidationError(
          `${prefix}.countryId must be a non-empty string for ${raw.type}`,
        );
      }
    } else if (raw.countryId !== null) {
      throw new SnapshotValidationError(
        `${prefix}.countryId must be null for ${raw.type}`,
      );
    }
    return {
      type: raw.type,
      turn: raw.turn as number,
      countryId: raw.countryId as string | null,
      diseaseId: raw.diseaseId as number,
    };
  });
  const publicOrderEvents = parsePublicOrderEvents(
    value.publicOrderEvents === undefined ? [] : value.publicOrderEvents,
  );

  return {
    capturedAt: value.capturedAt,
    diseaseTurn: value.diseaseTurn,
    eventTurn: value.eventTurn,
    day: value.day,
    gameDate: value.gameDate,
    cureProgress: value.cureProgress,
    countries: withCureRanks(countries),
    zombieHordeEvents,
    countryInfectionEvents,
    gameMilestones,
    publicOrderEvents,
  };
}
