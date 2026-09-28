export interface GovernmentActionEvent {
  id: string
  turn: number
  removed: boolean
}

export interface CountryCureResearch {
  funding: number
  allocation: number
  rank: number | null
  flasks: { active: number; inactive: number; destroyed: number }
}

export interface CountrySnapshot {
  index: number
  id: string
  currentPopulation: number
  originalPopulation: number
  healthyPopulation: number
  deadPopulation: number
  infected: number
  zombies: number
  governmentActions: GovernmentActionEvent[]
  cureResearch: CountryCureResearch | null
}

export interface ZombieHordeEvent {
  turn: number
  eventTurn: number
  diseaseId: number
  sourceCountryId: string
  destinationCountryId: string
  zombies: number
  vehicleId: number | null
  arrivalTurn: number | null
  arrivalEventTurn: number | null
}

export interface LiveSnapshot {
  capturedAt: string
  diseaseTurn: number
  eventTurn: number
  day: number
  gameDate: string
  cureProgress: number
  countries: CountrySnapshot[]
  zombieHordeEvents: ZombieHordeEvent[]
}

export interface HistoricalSnapshot extends LiveSnapshot {
  sessionId: string
}

export interface CollectorStatus {
  running: boolean
  lastError: string | null
}

export interface GameSession {
  id: string
  startedAt: string
  endedAt: string | null
  firstDay: number
  lastDay: number
}

export interface LiveState {
  collector: CollectorStatus
  session: GameSession | null
  snapshot: LiveSnapshot | null
}

export interface LiveSnapshotEvent {
  sessionId: string
  snapshot: LiveSnapshot
}

export type LiveSseEvent =
  | { type: 'state'; data: LiveState }
  | { type: 'snapshot'; data: LiveSnapshotEvent }
  | { type: 'status'; data: CollectorStatus }

export interface SessionSummary extends GameSession {
  snapshotCount: number
  isOpen: boolean
  firstGameDate: string | null
  lastGameDate: string | null
}

export interface SessionDetails {
  session: GameSession & { snapshotCount: number; isOpen: boolean }
  range: { firstGameDate: string | null; lastGameDate: string | null }
}

export interface GlobalHistoryPoint {
  capturedAt: string
  day: number
  gameDate: string
  diseaseTurn: number
  eventTurn: number
  cureProgress: number
  healthy: number
  infected: number
  dead: number
  zombies: number
  originalPopulation: number
}

export interface CountryHistoryPoint {
  capturedAt: string
  day: number
  gameDate: string
  currentPopulation: number
  originalPopulation: number
  healthyPopulation: number
  infected: number
  deadPopulation: number
  zombies: number
}

export interface SessionHistoryResponse {
  sessionId: string
  history: GlobalHistoryPoint[]
}

export interface CountryHistoryResponse {
  sessionId: string
  countryId: string
  history: CountryHistoryPoint[]
}

export interface SessionCountry {
  id: string
  index: number
}

export interface SessionCountriesResponse {
  sessionId: string
  countries: SessionCountry[]
}

export interface ApiErrorResponse {
  error: { code: string; message: string }
}
