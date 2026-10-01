import type {
  CollectorStatus, CountryCureResearch, CountryHistoryPoint, CountryHistoryResponse, CountryInfectionEvent, CountrySnapshot,
  InfrastructureStatus,
  GameMilestone, GameMilestoneType, GameSession, GlobalHistoryPoint, HistoricalSnapshot, LiveSnapshot, LiveSnapshotEvent, LiveState,
  PublicOrderEvent,
  SessionDetails, SessionHistoryResponse, SessionSummary,
  SessionCountriesResponse,
  ZombieHordeEvent,
} from './types.ts'
import { isPublicOrderStatus, publicOrderStatus, publicOrderStatuses } from '../domain/publicOrder.ts'

type RecordValue = Record<string, unknown>

const gameMilestoneTypes = new Set<GameMilestoneType>([
  'virus_dna_detected', 'more_infectious_than_tb', 'more_infectious_than_hiv',
  'disease_detected', 'first_death', 'more_infectious_than_common_cold',
  'worse_than_black_death', 'worse_than_spanish_flu', 'worse_than_smallpox',
])

function gameMilestoneType(value: unknown): GameMilestoneType {
  if (typeof value !== 'string' || !gameMilestoneTypes.has(value as GameMilestoneType)) {
    throw new Error('Invalid game milestone.type: unsupported type')
  }
  return value as GameMilestoneType
}

function record(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected object`)
  }
  return value as RecordValue
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array`)
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}: expected string`)
  return value
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected finite number`)
  }
  return value
}

function integer(value: unknown, label: string): number {
  const parsed = number(value, label)
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid ${label}: expected integer`)
  return parsed
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = integer(value, label)
  if (parsed < 0) throw new Error(`Invalid ${label}: expected non-negative integer`)
  return parsed
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}: expected boolean`)
  return value
}

function infrastructureStatus(value: unknown, label: string): InfrastructureStatus {
  if (value === undefined || value === null) return null
  if (value === 'open' || value === 'closed') return value
  throw new Error(`Invalid ${label}: expected "open", "closed", or null`)
}

export function parseCollectorStatus(value: unknown): CollectorStatus {
  const data = record(value, 'collector status')
  return { running: boolean(data.running, 'running'), lastError: nullableString(data.lastError, 'lastError') }
}

function parseCountry(value: unknown): CountrySnapshot {
  const data = record(value, 'country')
  const cureResearch = data.cureResearch === null ? null : parseCureResearch(data.cureResearch)
  const publicOrder = data.publicOrder === undefined || data.publicOrder === null
    ? null : number(data.publicOrder, 'country.publicOrder')
  if (publicOrder !== null && (publicOrder < 0 || publicOrder > 1)) {
    throw new Error('Invalid country.publicOrder: expected a fraction from 0 to 1')
  }
  return {
    index: number(data.index, 'country.index'),
    id: string(data.id, 'country.id'),
    currentPopulation: number(data.currentPopulation, 'country.currentPopulation'),
    originalPopulation: number(data.originalPopulation, 'country.originalPopulation'),
    healthyPopulation: number(data.healthyPopulation, 'country.healthyPopulation'),
    deadPopulation: number(data.deadPopulation, 'country.deadPopulation'),
    infected: number(data.infected, 'country.infected'),
    zombies: number(data.zombies, 'country.zombies'),
    publicOrder,
    borderStatus: infrastructureStatus(data.borderStatus, 'country.borderStatus'),
    airportStatus: infrastructureStatus(data.airportStatus, 'country.airportStatus'),
    portStatus: infrastructureStatus(data.portStatus, 'country.portStatus'),
    governmentActions: array(data.governmentActions, 'country.governmentActions').map((value) => {
      const action = record(value, 'country.governmentActions event')
      return { id: string(action.id, 'government action.id'), turn: integer(action.turn, 'government action.turn'),
        removed: boolean(action.removed, 'government action.removed') }
    }),
    cureResearch,
  }
}

function parseCureResearch(value: unknown): CountryCureResearch {
  const data = record(value, 'country.cureResearch')
  const flasks = record(data.flasks, 'country.cureResearch.flasks')
  const rank = data.rank === null ? null : integer(data.rank, 'country.cureResearch.rank')
  if (rank !== null && rank < 1) throw new Error('Invalid country.cureResearch.rank: expected positive integer')
  return {
    funding: number(data.funding, 'country.cureResearch.funding'),
    allocation: number(data.allocation, 'country.cureResearch.allocation'),
    rank,
    flasks: {
      active: nonNegativeInteger(flasks.active, 'country.cureResearch.flasks.active'),
      inactive: nonNegativeInteger(flasks.inactive, 'country.cureResearch.flasks.inactive'),
      destroyed: nonNegativeInteger(flasks.destroyed, 'country.cureResearch.flasks.destroyed'),
    },
  }
}

function parseZombieHordeEvent(value: unknown): ZombieHordeEvent {
  const data = record(value, 'zombie horde event')
  const turn = nonNegativeInteger(data.turn, 'zombie horde.turn')
  const arrivalTurn = data.arrivalTurn == null ? null
    : nonNegativeInteger(data.arrivalTurn, 'zombie horde.arrivalTurn')
  if (arrivalTurn !== null && arrivalTurn < turn) {
    throw new Error('Invalid zombie horde.arrivalTurn: expected at least turn')
  }
  const sourceCountryId = string(data.sourceCountryId, 'zombie horde.sourceCountryId')
  const destinationCountryId = string(data.destinationCountryId, 'zombie horde.destinationCountryId')
  if (!sourceCountryId.trim() || !destinationCountryId.trim()) {
    throw new Error('Invalid zombie horde country ID: expected non-empty string')
  }
  return {
    turn,
    eventTurn: nonNegativeInteger(data.eventTurn, 'zombie horde.eventTurn'),
    diseaseId: nonNegativeInteger(data.diseaseId, 'zombie horde.diseaseId'),
    sourceCountryId,
    destinationCountryId,
    zombies: nonNegativeInteger(data.zombies, 'zombie horde.zombies'),
    vehicleId: data.vehicleId == null ? null : nonNegativeInteger(data.vehicleId, 'zombie horde.vehicleId'),
    arrivalTurn,
    arrivalEventTurn: data.arrivalEventTurn == null ? null
      : nonNegativeInteger(data.arrivalEventTurn, 'zombie horde.arrivalEventTurn'),
  }
}

function parseCountryInfectionEvent(value: unknown): CountryInfectionEvent {
  const data = record(value, 'country infection event')
  const countryId = string(data.countryId, 'country infection.countryId')
  if (!countryId.trim() || countryId.length > 4096) {
    throw new Error('Invalid country infection.countryId: expected non-empty string')
  }
  return {
    countryId,
    turn: integer(data.turn, 'country infection.turn'),
    eventTurn: integer(data.eventTurn, 'country infection.eventTurn'),
    diseaseId: integer(data.diseaseId, 'country infection.diseaseId'),
  }
}

function parseGameMilestone(value: unknown): GameMilestone {
  const data = record(value, 'game milestone')
  const type = gameMilestoneType(data.type)
  const needsCountry = type === 'disease_detected' || type === 'first_death'
  let countryId: string | null = null
  if (needsCountry) {
    countryId = string(data.countryId, 'game milestone.countryId')
    if (!countryId.trim() || countryId.length > 4096) {
      throw new Error('Invalid game milestone.countryId: expected non-empty string')
    }
  } else if (data.countryId !== null) {
    throw new Error('Invalid game milestone.countryId: expected null for global milestone')
  }
  return {
    type,
    turn: integer(data.turn, 'game milestone.turn'),
    countryId,
    diseaseId: integer(data.diseaseId, 'game milestone.diseaseId'),
  }
}

function parsePublicOrderEvent(value: unknown): PublicOrderEvent {
  const data = record(value, 'public order event')
  const countryId = string(data.countryId, 'public order.countryId')
  if (!countryId.trim() || countryId.length > 4096) {
    throw new Error('Invalid public order.countryId: expected non-empty string')
  }
  const turn = nonNegativeInteger(data.turn, 'public order.turn')
  if (!isPublicOrderStatus(data.fromStatus) || !isPublicOrderStatus(data.toStatus)
    || data.fromStatus === data.toStatus) {
    throw new Error('Invalid public order status transition')
  }
  const raw = number(data.publicOrder, 'public order.publicOrder')
  if (raw < 0 || raw > 1 || publicOrderStatus(raw) !== data.toStatus) {
    throw new Error('Invalid public order.publicOrder: does not match toStatus')
  }
  const expectedDirection = publicOrderStatuses.indexOf(data.toStatus) > publicOrderStatuses.indexOf(data.fromStatus)
    ? 'deteriorated' : 'improved'
  if (data.direction !== expectedDirection) throw new Error('Invalid public order.direction')
  return { countryId, turn, fromStatus: data.fromStatus, toStatus: data.toStatus,
    publicOrder: raw, direction: expectedDirection }
}

export function parseLiveSnapshot(value: unknown): LiveSnapshot {
  const data = record(value, 'live snapshot')
  return {
    capturedAt: string(data.capturedAt, 'capturedAt'),
    diseaseTurn: number(data.diseaseTurn, 'diseaseTurn'),
    eventTurn: number(data.eventTurn, 'eventTurn'),
    day: number(data.day, 'day'),
    gameDate: string(data.gameDate, 'gameDate'),
    cureProgress: number(data.cureProgress, 'cureProgress'),
    countries: array(data.countries, 'countries').map(parseCountry),
    zombieHordeEvents: (data.zombieHordeEvents === undefined ? []
      : array(data.zombieHordeEvents, 'zombieHordeEvents')).map(parseZombieHordeEvent),
    countryInfectionEvents: (data.countryInfectionEvents === undefined ? []
      : array(data.countryInfectionEvents, 'countryInfectionEvents')).map(parseCountryInfectionEvent),
    gameMilestones: (data.gameMilestones === undefined ? []
      : array(data.gameMilestones, 'gameMilestones')).map(parseGameMilestone),
    publicOrderEvents: (data.publicOrderEvents === undefined ? []
      : array(data.publicOrderEvents, 'publicOrderEvents')).map(parsePublicOrderEvent),
  }
}

export function parseHistoricalSnapshot(value: unknown): HistoricalSnapshot {
  const data = record(value, 'historical snapshot')
  return { ...parseLiveSnapshot(data), sessionId: string(data.sessionId, 'sessionId') }
}

function parseSession(value: unknown): GameSession {
  const data = record(value, 'session')
  return {
    id: string(data.id, 'session.id'),
    startedAt: string(data.startedAt, 'session.startedAt'),
    endedAt: nullableString(data.endedAt, 'session.endedAt'),
    firstDay: number(data.firstDay, 'session.firstDay'),
    lastDay: number(data.lastDay, 'session.lastDay'),
  }
}

export function parseLiveState(value: unknown): LiveState {
  const data = record(value, 'live state')
  return {
    collector: parseCollectorStatus(data.collector),
    session: data.session === null ? null : parseSession(data.session),
    snapshot: data.snapshot === null ? null : parseLiveSnapshot(data.snapshot),
  }
}

export function parseLiveSnapshotEvent(value: unknown): LiveSnapshotEvent {
  const data = record(value, 'snapshot event')
  return { sessionId: string(data.sessionId, 'sessionId'), snapshot: parseLiveSnapshot(data.snapshot) }
}

export function parseSessions(value: unknown): SessionSummary[] {
  return array(value, 'sessions').map((entry) => {
    const data = record(entry, 'session summary')
    return {
      ...parseSession(data),
      snapshotCount: number(data.snapshotCount, 'snapshotCount'),
      isOpen: boolean(data.isOpen, 'isOpen'),
      firstGameDate: nullableString(data.firstGameDate, 'firstGameDate'),
      lastGameDate: nullableString(data.lastGameDate, 'lastGameDate'),
    }
  })
}

export function parseSessionDetails(value: unknown): SessionDetails {
  const data = record(value, 'session details')
  const session = record(data.session, 'session details.session')
  const range = record(data.range, 'session details.range')
  return {
    session: {
      ...parseSession(session),
      snapshotCount: number(session.snapshotCount, 'snapshotCount'),
      isOpen: boolean(session.isOpen, 'isOpen'),
    },
    range: {
      firstGameDate: nullableString(range.firstGameDate, 'firstGameDate'),
      lastGameDate: nullableString(range.lastGameDate, 'lastGameDate'),
    },
  }
}

function parseGlobalPoint(value: unknown): GlobalHistoryPoint {
  const data = record(value, 'global history point')
  return {
    capturedAt: string(data.capturedAt, 'capturedAt'),
    day: number(data.day, 'day'),
    gameDate: string(data.gameDate, 'gameDate'),
    diseaseTurn: number(data.diseaseTurn, 'diseaseTurn'),
    eventTurn: number(data.eventTurn, 'eventTurn'),
    cureProgress: number(data.cureProgress, 'cureProgress'),
    healthy: number(data.healthy, 'healthy'),
    infected: number(data.infected, 'infected'),
    dead: number(data.dead, 'dead'),
    zombies: number(data.zombies, 'zombies'),
    originalPopulation: number(data.originalPopulation, 'originalPopulation'),
  }
}

export function parseSessionHistory(value: unknown): SessionHistoryResponse {
  const data = record(value, 'session history')
  return {
    sessionId: string(data.sessionId, 'sessionId'),
    history: array(data.history, 'history').map(parseGlobalPoint),
  }
}

function parseCountryPoint(value: unknown): CountryHistoryPoint {
  const data = record(value, 'country history point')
  return {
    capturedAt: string(data.capturedAt, 'capturedAt'),
    day: number(data.day, 'day'),
    gameDate: string(data.gameDate, 'gameDate'),
    currentPopulation: number(data.currentPopulation, 'currentPopulation'),
    originalPopulation: number(data.originalPopulation, 'originalPopulation'),
    healthyPopulation: number(data.healthyPopulation, 'healthyPopulation'),
    infected: number(data.infected, 'infected'),
    deadPopulation: number(data.deadPopulation, 'deadPopulation'),
    zombies: number(data.zombies, 'zombies'),
  }
}

export function parseCountryHistory(value: unknown): CountryHistoryResponse {
  const data = record(value, 'country history')
  return {
    sessionId: string(data.sessionId, 'sessionId'),
    countryId: string(data.countryId, 'countryId'),
    history: array(data.history, 'history').map(parseCountryPoint),
  }
}

export function parseSessionCountries(value: unknown): SessionCountriesResponse {
  const data = record(value, 'session countries')
  return {
    sessionId: string(data.sessionId, 'sessionId'),
    countries: array(data.countries, 'countries').map((entry) => {
      const country = record(entry, 'session country')
      return { id: string(country.id, 'country.id'), index: number(country.index, 'country.index') }
    }),
  }
}
