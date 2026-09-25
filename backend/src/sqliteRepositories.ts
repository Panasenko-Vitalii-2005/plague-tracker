import type Database from 'better-sqlite3';
import type {
  CountryHistoryPoint, CountrySnapshot, GameSession, GlobalHistoryPoint,
  HistoricalSnapshot, SessionStats,
  SessionCountry,
} from './types.js';
import type { SessionRepository, SnapshotRepository } from './repositories.js';

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  first_day: number;
  last_day: number;
}

interface DailyRow {
  session_id: string;
  day: number;
  captured_at: string;
  game_date: string;
  disease_turn: number;
  event_turn: number;
  cure_progress: number;
}

interface CountryRow {
  country_index: number;
  country_id: string;
  current_population: number;
  original_population: number;
  healthy_population: number;
  dead_population: number;
  infected: number;
  zombies: number;
}

interface SessionStatsRow {
  session_id: string;
  snapshot_count: number;
  first_game_date: string | null;
  last_game_date: string | null;
}

interface GlobalHistoryRow {
  captured_at: string;
  day: number;
  game_date: string;
  disease_turn: number;
  event_turn: number;
  cure_progress: number;
  healthy: number;
  infected: number;
  dead: number;
  zombies: number;
  original_population: number;
}

interface CountryHistoryRow extends CountryRow {
  captured_at: string;
  day: number;
  game_date: string;
}

interface SessionCountryRow {
  country_id: string;
  country_index: number;
}

function sessionFromRow(row: SessionRow): GameSession {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    firstDay: row.first_day,
    lastDay: row.last_day,
  };
}

function countryFromRow(row: CountryRow): CountrySnapshot {
  return {
    index: row.country_index,
    id: row.country_id,
    currentPopulation: row.current_population,
    originalPopulation: row.original_population,
    healthyPopulation: row.healthy_population,
    deadPopulation: row.dead_population,
    infected: row.infected,
    zombies: row.zombies,
  };
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database.Database) {}

  save(session: GameSession): void {
    this.db.prepare(`
      INSERT INTO game_sessions (id, started_at, ended_at, first_day, last_day)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        first_day = excluded.first_day,
        last_day = excluded.last_day
    `).run(session.id, session.startedAt, session.endedAt, session.firstDay, session.lastDay);
  }

  list(): GameSession[] {
    return this.db.prepare<[], SessionRow>(
      'SELECT * FROM game_sessions ORDER BY started_at, rowid',
    ).all().map(sessionFromRow);
  }

  getById(id: string): GameSession | null {
    const row = this.db.prepare<[string], SessionRow>(
      'SELECT * FROM game_sessions WHERE id = ?',
    ).get(id);
    return row ? sessionFromRow(row) : null;
  }

  getLatestOpen(): GameSession | null {
    const row = this.db.prepare<[], SessionRow>(`
      SELECT * FROM game_sessions WHERE ended_at IS NULL
      ORDER BY started_at DESC, rowid DESC LIMIT 1
    `).get();
    return row ? sessionFromRow(row) : null;
  }
}

export class SqliteSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  save(snapshot: HistoricalSnapshot): void {
    const upsert = this.db.prepare(`
      INSERT INTO daily_snapshots
        (session_id, day, captured_at, game_date, disease_turn, event_turn, cure_progress)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, day) DO UPDATE SET
        captured_at = excluded.captured_at,
        game_date = excluded.game_date,
        disease_turn = excluded.disease_turn,
        event_turn = excluded.event_turn,
        cure_progress = excluded.cure_progress
    `);
    const clearCountries = this.db.prepare(
      'DELETE FROM country_snapshots WHERE session_id = ? AND day = ?',
    );
    const insertCountry = this.db.prepare(`
      INSERT INTO country_snapshots
        (session_id, day, country_id, country_index, current_population,
         original_population, healthy_population, dead_population, infected, zombies)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      upsert.run(
        snapshot.sessionId, snapshot.day, snapshot.capturedAt, snapshot.gameDate,
        snapshot.diseaseTurn, snapshot.eventTurn, snapshot.cureProgress,
      );
      clearCountries.run(snapshot.sessionId, snapshot.day);
      for (const country of snapshot.countries) {
        insertCountry.run(
          snapshot.sessionId, snapshot.day, country.id, country.index,
          country.currentPopulation, country.originalPopulation,
          country.healthyPopulation, country.deadPopulation,
          country.infected, country.zombies,
        );
      }
    })();
  }

  list(sessionId?: string): HistoricalSnapshot[] {
    const rows = sessionId === undefined
      ? this.db.prepare<[], DailyRow>(`
          SELECT d.* FROM daily_snapshots d
          JOIN game_sessions s ON s.id = d.session_id
          ORDER BY s.started_at, s.rowid, d.day
        `).all()
      : this.db.prepare<[string], DailyRow>(`
          SELECT * FROM daily_snapshots WHERE session_id = ? ORDER BY day
        `).all(sessionId);
    return rows.map((row) => this.hydrate(row));
  }

  getLatestForSession(sessionId: string): HistoricalSnapshot | null {
    const row = this.db.prepare<[string], DailyRow>(`
      SELECT * FROM daily_snapshots WHERE session_id = ? ORDER BY day DESC LIMIT 1
    `).get(sessionId);
    return row ? this.hydrate(row) : null;
  }

  getSessionStats(sessionId?: string): SessionStats[] {
    const query = `
      SELECT s.id AS session_id, COUNT(d.day) AS snapshot_count,
        (SELECT first.game_date FROM daily_snapshots first
          WHERE first.session_id = s.id ORDER BY first.day ASC LIMIT 1) AS first_game_date,
        (SELECT last.game_date FROM daily_snapshots last
          WHERE last.session_id = s.id ORDER BY last.day DESC LIMIT 1) AS last_game_date
      FROM game_sessions s
      LEFT JOIN daily_snapshots d ON d.session_id = s.id
    `;
    const rows = sessionId === undefined
      ? this.db.prepare<[], SessionStatsRow>(`${query} GROUP BY s.id`).all()
      : this.db.prepare<[string], SessionStatsRow>(`${query} WHERE s.id = ? GROUP BY s.id`).all(sessionId);
    return rows.map((row) => ({
      sessionId: row.session_id,
      snapshotCount: row.snapshot_count,
      firstGameDate: row.first_game_date,
      lastGameDate: row.last_game_date,
    }));
  }

  getGlobalHistory(sessionId: string): GlobalHistoryPoint[] {
    const rows = this.db.prepare<[string], GlobalHistoryRow>(`
      SELECT d.captured_at, d.day, d.game_date, d.disease_turn, d.event_turn,
        d.cure_progress,
        COALESCE(SUM(c.healthy_population), 0) AS healthy,
        COALESCE(SUM(c.infected), 0) AS infected,
        COALESCE(SUM(c.dead_population), 0) AS dead,
        COALESCE(SUM(c.zombies), 0) AS zombies,
        COALESCE(SUM(c.original_population), 0) AS original_population
      FROM daily_snapshots d
      LEFT JOIN country_snapshots c
        ON c.session_id = d.session_id AND c.day = d.day
      WHERE d.session_id = ?
      GROUP BY d.session_id, d.day
      ORDER BY d.day ASC
    `).all(sessionId);
    return rows.map((row) => ({
      capturedAt: row.captured_at,
      day: row.day,
      gameDate: row.game_date,
      diseaseTurn: row.disease_turn,
      eventTurn: row.event_turn,
      cureProgress: row.cure_progress,
      healthy: row.healthy,
      infected: row.infected,
      dead: row.dead,
      zombies: row.zombies,
      originalPopulation: row.original_population,
    }));
  }

  getCountryHistory(sessionId: string, countryId: string): CountryHistoryPoint[] {
    const rows = this.db.prepare<[string, string], CountryHistoryRow>(`
      SELECT d.captured_at, d.day, d.game_date, c.*
      FROM daily_snapshots d
      JOIN country_snapshots c
        ON c.session_id = d.session_id AND c.day = d.day
      WHERE d.session_id = ? AND c.country_id = ?
      ORDER BY d.day ASC
    `).all(sessionId, countryId);
    return rows.map((row) => ({
      capturedAt: row.captured_at,
      day: row.day,
      gameDate: row.game_date,
      currentPopulation: row.current_population,
      originalPopulation: row.original_population,
      healthyPopulation: row.healthy_population,
      infected: row.infected,
      deadPopulation: row.dead_population,
      zombies: row.zombies,
    }));
  }

  getCountriesForSession(sessionId: string): SessionCountry[] {
    const rows = this.db.prepare<[string], SessionCountryRow>(`
      SELECT country_id, MIN(country_index) AS country_index
      FROM country_snapshots
      WHERE session_id = ?
      GROUP BY country_id
      ORDER BY country_index ASC, country_id ASC
    `).all(sessionId);
    return rows.map((row) => ({ id: row.country_id, index: row.country_index }));
  }

  private hydrate(row: DailyRow): HistoricalSnapshot {
    const countries = this.db.prepare<[string, number], CountryRow>(`
      SELECT * FROM country_snapshots
      WHERE session_id = ? AND day = ? ORDER BY country_index
    `).all(row.session_id, row.day).map(countryFromRow);
    return {
      sessionId: row.session_id,
      capturedAt: row.captured_at,
      day: row.day,
      gameDate: row.game_date,
      diseaseTurn: row.disease_turn,
      eventTurn: row.event_turn,
      cureProgress: row.cure_progress,
      countries,
    };
  }
}
