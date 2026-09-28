import type {
  CountryHistoryPoint, GameSession, GameSnapshot, GlobalHistoryPoint,
  HistoricalSnapshot, SessionStats,
  SessionCountry,
} from './types.js';
import { withCureRanks } from './cureRanks.js';

export type RepositoryResult<T> = T | Promise<T>;

export interface SessionRepository {
  save(session: GameSession): RepositoryResult<void>;
  list(): RepositoryResult<GameSession[]>;
  getById(id: string): RepositoryResult<GameSession | null>;
  getLatestOpen(): RepositoryResult<GameSession | null>;
}

export interface SnapshotRepository {
  // Upsert by (sessionId, day): a day can never have two historical records.
  save(snapshot: HistoricalSnapshot): RepositoryResult<void>;
  list(sessionId?: string): RepositoryResult<HistoricalSnapshot[]>;
  getLatestForSession(sessionId: string): RepositoryResult<HistoricalSnapshot | null>;
  getByDay(sessionId: string, day: number): RepositoryResult<HistoricalSnapshot | null>;
  getSessionStats(sessionId?: string): RepositoryResult<SessionStats[]>;
  getGlobalHistory(sessionId: string): RepositoryResult<GlobalHistoryPoint[]>;
  getCountryHistory(sessionId: string, countryId: string): RepositoryResult<CountryHistoryPoint[]>;
  getCountriesForSession(sessionId: string): RepositoryResult<SessionCountry[]>;
}

export function copySnapshot(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    countries: withCureRanks(snapshot.countries.map((country) => ({ ...country,
      governmentActions: (country.governmentActions ?? []).map((action) => ({ ...action })),
      cureResearch: country.cureResearch ? { ...country.cureResearch,
        flasks: { ...country.cureResearch.flasks } } : null,
    }))),
    zombieHordeEvents: snapshot.zombieHordeEvents.map((event) => ({ ...event })),
    countryInfectionEvents: snapshot.countryInfectionEvents.map((event) => ({ ...event })),
  };
}

export function copyHistoricalSnapshot(snapshot: HistoricalSnapshot): HistoricalSnapshot {
  return { ...copySnapshot(snapshot), sessionId: snapshot.sessionId };
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, GameSession>();

  save(session: GameSession): void {
    this.sessions.set(session.id, { ...session });
  }

  list(): GameSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  getById(id: string): GameSession | null {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  getLatestOpen(): GameSession | null {
    const open = [...this.sessions.values()].filter((session) => session.endedAt === null);
    return open.length > 0 ? { ...open[open.length - 1]! } : null;
  }
}

export class InMemorySnapshotRepository implements SnapshotRepository {
  private readonly snapshots = new Map<string, Map<number, HistoricalSnapshot>>();

  save(snapshot: HistoricalSnapshot): void {
    let days = this.snapshots.get(snapshot.sessionId);
    if (!days) {
      days = new Map();
      this.snapshots.set(snapshot.sessionId, days);
    }
    days.set(snapshot.day, copyHistoricalSnapshot(snapshot));
  }

  list(sessionId?: string): HistoricalSnapshot[] {
    if (sessionId !== undefined) {
      return [...(this.snapshots.get(sessionId)?.values() ?? [])]
        .sort((left, right) => left.day - right.day)
        .map(copyHistoricalSnapshot);
    }

    return [...this.snapshots.values()]
      .flatMap((days) => [...days.values()].sort((left, right) => left.day - right.day))
      .map(copyHistoricalSnapshot);
  }

  getLatestForSession(sessionId: string): HistoricalSnapshot | null {
    const days = this.snapshots.get(sessionId);
    if (!days) return null;
    let latest: HistoricalSnapshot | null = null;
    for (const snapshot of days.values()) {
      if (!latest || snapshot.day > latest.day) latest = snapshot;
    }
    return latest ? copyHistoricalSnapshot(latest) : null;
  }

  getByDay(sessionId: string, day: number): HistoricalSnapshot | null {
    const snapshot = this.snapshots.get(sessionId)?.get(day);
    if (!snapshot) return null;
    const result = copyHistoricalSnapshot(snapshot);
    result.countries.sort((a, b) => a.index - b.index);
    return result;
  }

  getSessionStats(sessionId?: string): SessionStats[] {
    const ids = sessionId === undefined ? [...this.snapshots.keys()] : [sessionId];
    return ids.map((id) => {
      const days = this.list(id);
      return {
        sessionId: id,
        snapshotCount: days.length,
        firstGameDate: days[0]?.gameDate ?? null,
        lastGameDate: days[days.length - 1]?.gameDate ?? null,
      };
    });
  }

  getGlobalHistory(sessionId: string): GlobalHistoryPoint[] {
    return this.list(sessionId).map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      day: snapshot.day,
      gameDate: snapshot.gameDate,
      diseaseTurn: snapshot.diseaseTurn,
      eventTurn: snapshot.eventTurn,
      cureProgress: snapshot.cureProgress,
      healthy: snapshot.countries.reduce((total, country) => total + country.healthyPopulation, 0),
      infected: snapshot.countries.reduce((total, country) => total + country.infected, 0),
      dead: snapshot.countries.reduce((total, country) => total + country.deadPopulation, 0),
      zombies: snapshot.countries.reduce((total, country) => total + country.zombies, 0),
      originalPopulation: snapshot.countries.reduce((total, country) => total + country.originalPopulation, 0),
    }));
  }

  getCountryHistory(sessionId: string, countryId: string): CountryHistoryPoint[] {
    return this.list(sessionId).flatMap((snapshot) => {
      const country = snapshot.countries.find((item) => item.id === countryId);
      return country ? [{
        capturedAt: snapshot.capturedAt,
        day: snapshot.day,
        gameDate: snapshot.gameDate,
        currentPopulation: country.currentPopulation,
        originalPopulation: country.originalPopulation,
        healthyPopulation: country.healthyPopulation,
        infected: country.infected,
        deadPopulation: country.deadPopulation,
        zombies: country.zombies,
      }] : [];
    });
  }

  getCountriesForSession(sessionId: string): SessionCountry[] {
    const indexes = new Map<string, number>();
    for (const snapshot of this.list(sessionId)) {
      for (const country of snapshot.countries) {
        const previous = indexes.get(country.id);
        if (previous === undefined || country.index < previous) indexes.set(country.id, country.index);
      }
    }
    return [...indexes].map(([id, index]) => ({ id, index }))
      .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  }
}
