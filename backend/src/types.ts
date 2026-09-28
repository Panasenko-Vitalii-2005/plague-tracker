export interface CountrySnapshot {
  index: number;
  id: string;
  currentPopulation: number;
  originalPopulation: number;
  healthyPopulation: number;
  deadPopulation: number;
  infected: number;
  zombies: number;
  governmentActions: GovernmentActionEvent[];
  cureResearch: CountryCureResearch | null;
}

export interface GovernmentActionEvent {
  id: string;
  turn: number;
  removed: boolean;
}

export interface CountryCureResearch {
  funding: number;
  allocation: number;
  rank: number | null;
  flasks: { active: number; inactive: number; destroyed: number };
}

export interface ZombieHordeEvent {
  turn: number;
  eventTurn: number;
  diseaseId: number;
  sourceCountryId: string;
  destinationCountryId: string;
  zombies: number;
  vehicleId: number | null;
  arrivalTurn: number | null;
  arrivalEventTurn: number | null;
}

export interface GameSnapshot {
  capturedAt: string;
  diseaseTurn: number;
  eventTurn: number;
  day: number;
  gameDate: string;
  cureProgress: number;
  countries: CountrySnapshot[];
  zombieHordeEvents: ZombieHordeEvent[];
}

export interface GameSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  firstDay: number;
  lastDay: number;
}

export interface HistoricalSnapshot extends GameSnapshot {
  sessionId: string;
}

export interface SessionStats {
  sessionId: string;
  snapshotCount: number;
  firstGameDate: string | null;
  lastGameDate: string | null;
}

export interface SessionCountry {
  id: string;
  index: number;
}

export interface GlobalHistoryPoint {
  capturedAt: string;
  day: number;
  gameDate: string;
  diseaseTurn: number;
  eventTurn: number;
  cureProgress: number;
  healthy: number;
  infected: number;
  dead: number;
  zombies: number;
  originalPopulation: number;
}

export interface CountryHistoryPoint {
  capturedAt: string;
  day: number;
  gameDate: string;
  currentPopulation: number;
  originalPopulation: number;
  healthyPopulation: number;
  infected: number;
  deadPopulation: number;
  zombies: number;
}

export type CollectorState = 'stopped' | 'starting' | 'running' | 'failed';

export interface CollectorExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  requested: boolean;
}

export interface CollectorStatus {
  state: CollectorState;
  pid: number | null;
  startedAt: string | null;
  lastSnapshotAt: string | null;
  lastDiseaseTurn: number | null;
  lastError: string | null;
  exit: CollectorExit | null;
}
