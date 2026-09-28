export interface CountrySnapshot {
  index: number;
  id: string;
  currentPopulation: number;
  originalPopulation: number;
  healthyPopulation: number;
  deadPopulation: number;
  infected: number;
  zombies: number;
  publicOrder: number | null;
  borderStatus: InfrastructureStatus;
  airportStatus: InfrastructureStatus;
  portStatus: InfrastructureStatus;
  governmentActions: GovernmentActionEvent[];
  cureResearch: CountryCureResearch | null;
}

export type InfrastructureStatus = 'open' | 'closed' | null;

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

export interface CountryInfectionEvent {
  countryId: string;
  turn: number;
  eventTurn: number;
  diseaseId: number;
}

export type GameMilestoneType =
  | 'virus_dna_detected'
  | 'more_infectious_than_tb'
  | 'more_infectious_than_hiv'
  | 'disease_detected'
  | 'first_death'
  | 'more_infectious_than_common_cold'
  | 'worse_than_black_death'
  | 'worse_than_spanish_flu'
  | 'worse_than_smallpox';

export interface GameMilestone {
  type: GameMilestoneType;
  turn: number;
  countryId: string | null;
  diseaseId: number;
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
  countryInfectionEvents: CountryInfectionEvent[];
  gameMilestones: GameMilestone[];
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
