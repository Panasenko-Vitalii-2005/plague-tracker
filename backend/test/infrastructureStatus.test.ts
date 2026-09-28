import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { buildApi } from '../src/api.js';
import { openDatabase } from '../src/database.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { copySnapshot } from '../src/repositories.js';
import { SqliteSessionRepository, SqliteSnapshotRepository } from '../src/sqliteRepositories.js';
import { validateSnapshot } from '../src/validateSnapshot.js';

type Status = 'open' | 'closed' | null;

function rawSnapshot(day: number, statuses: Array<[unknown, unknown, unknown]>) {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2027, 0, day + 1)).toISOString().slice(0, 10),
    diseaseTurn: day,
    eventTurn: day + 40,
    cureProgress: 0.5,
    zombieHordeEvents: [],
    countryInfectionEvents: [],
    countries: statuses.map(([borderStatus, airportStatus, portStatus], index) => ({
      index, id: ['egypt', 'russia'][index] ?? `country_${index}`,
      currentPopulation: 100, originalPopulation: 100,
      healthyPopulation: 90, deadPopulation: 0, infected: 10, zombies: 0,
      publicOrder: null, governmentActions: [], cureResearch: null,
      borderStatus, airportStatus, portStatus,
    })),
  };
}

function statuses(country: { borderStatus: Status; airportStatus: Status; portStatus: Status }): Status[] {
  return [country.borderStatus, country.airportStatus, country.portStatus];
}

test('infrastructure validation preserves exact independent values and normalizes absent fields', () => {
  const raw = rawSnapshot(10, [['closed', 'open', null], ['open', 'closed', 'open']]);
  const { borderStatus: _border, airportStatus: _airport, portStatus: _port, ...legacy } = raw.countries[1]!;
  const parsed = validateSnapshot({ ...raw, countries: [raw.countries[0], legacy] });
  assert.deepEqual(parsed.countries.map(statuses), [['closed', 'open', null], [null, null, null]]);
  assert.deepEqual(validateSnapshot(raw).countries.map(statuses),
    [['closed', 'open', null], ['open', 'closed', 'open']]);
  const copied = copySnapshot(parsed);
  copied.countries[0]!.borderStatus = 'open';
  assert.equal(parsed.countries[0]!.borderStatus, 'closed');
  assert.deepEqual(validateSnapshot(rawSnapshot(10, [[null, null, null]])).countries.map(statuses),
    [[null, null, null]]);
});

test('infrastructure validation rejects unknown strings and every wrong JSON type', () => {
  for (const field of ['borderStatus', 'airportStatus', 'portStatus'] as const) {
    for (const invalid of ['OPEN', 'unknown', '', 0, 1, true, false, [], {}]) {
      const raw = rawSnapshot(10, [['closed', 'open', null]]);
      raw.countries[0]![field] = invalid;
      assert.throws(() => validateSnapshot(raw), new RegExp(`countries\\[0\\]\\.${field}`));
    }
  }
});

test('SQLite round-trip and live/history APIs keep the selected day isolated', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-infrastructure-'));
  const databasePath = path.join(directory, 'history.sqlite');
  let db = openDatabase(databasePath);
  t.after(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  let sessions = new SqliteSessionRepository(db);
  let snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'infrastructure-session' });
  const first = validateSnapshot(rawSnapshot(10, [['closed', 'open', null], ['open', 'closed', 'open']]));
  const second = validateSnapshot(rawSnapshot(11, [['open', 'closed', 'closed'], ['closed', 'open', null]]));
  await tracker.handleSnapshot(first);
  await tracker.handleSnapshot(second);
  await tracker.flush();
  assert.deepEqual(db.prepare<[string, number], { border_status: Status; airport_status: Status; port_status: Status }>(
    'SELECT border_status, airport_status, port_status FROM country_snapshots WHERE country_id = ? AND day = ?',
  ).get('egypt', 10), { border_status: 'closed', airport_status: 'open', port_status: null });
  db.close();

  db = openDatabase(databasePath);
  sessions = new SqliteSessionRepository(db);
  snapshots = new SqliteSnapshotRepository(db);
  assert.deepEqual(snapshots.getByDay('infrastructure-session', 10)!.countries.map(statuses),
    [['closed', 'open', null], ['open', 'closed', 'open']]);
  assert.deepEqual(snapshots.getByDay('infrastructure-session', 11)!.countries.map(statuses),
    [['open', 'closed', 'closed'], ['closed', 'open', null]]);
  assert.throws(() => db.prepare(
    "UPDATE country_snapshots SET border_status = 'unknown' WHERE session_id = 'infrastructure-session' AND day = 10",
  ).run(), /CHECK/);
  assert.deepEqual(snapshots.getByDay('infrastructure-session', 10)!.countries.map(statuses),
    [['closed', 'open', null], ['open', 'closed', 'open']]);
  const resumed = new GameSessionTracker({ sessions, snapshots });
  await resumed.initialize();
  const live = validateSnapshot(rawSnapshot(12, [['closed', 'closed', 'open'], [null, 'open', 'closed']]));
  await resumed.handleSnapshot(live);
  const app = buildApi({ tracker: resumed, sessions, snapshots,
    collector: { getStatus: () => ({ state: 'running', pid: 1, startedAt: null,
      lastSnapshotAt: live.capturedAt, lastDiseaseTurn: 12, lastError: null, exit: null }),
    getLatestSnapshot: () => live },
    liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
  t.after(() => app.close());

  const liveResponse = await app.inject('/api/v1/live');
  const day10 = await app.inject('/api/v1/sessions/infrastructure-session/days/10');
  const day11 = await app.inject('/api/v1/sessions/infrastructure-session/days/11');
  assert.equal(liveResponse.statusCode, 200);
  assert.equal(day10.statusCode, 200);
  assert.equal(day11.statusCode, 200);
  assert.deepEqual(liveResponse.json().snapshot.countries.map(statuses),
    [['closed', 'closed', 'open'], [null, 'open', 'closed']]);
  assert.deepEqual(day10.json().countries.map(statuses),
    [['closed', 'open', null], ['open', 'closed', 'open']]);
  assert.deepEqual(day11.json().countries.map(statuses),
    [['open', 'closed', 'closed'], ['closed', 'open', null]]);
  assert.deepEqual((await app.inject('/api/v1/sessions/infrastructure-session/days/10'))
    .json().countries.map(statuses), [['closed', 'open', null], ['open', 'closed', 'open']]);
});

test('migration 5 upgrades version-4 rows without inventing infrastructure states', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-infrastructure-v4-'));
  const databasePath = path.join(directory, 'history.sqlite');
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, '2026-09-01'), (2, '2026-09-01'),
      (3, '2026-09-01'), (4, '2026-09-01');
    CREATE TABLE game_sessions (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
      first_day INTEGER NOT NULL, last_day INTEGER NOT NULL);
    CREATE TABLE daily_snapshots (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, captured_at TEXT NOT NULL,
      game_date TEXT NOT NULL, disease_turn INTEGER NOT NULL, event_turn INTEGER NOT NULL,
      cure_progress REAL NOT NULL, zombie_horde_events_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (session_id, day));
    CREATE TABLE country_snapshots (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, country_id TEXT NOT NULL,
      country_index INTEGER NOT NULL, current_population INTEGER NOT NULL,
      original_population INTEGER NOT NULL, healthy_population INTEGER NOT NULL,
      dead_population INTEGER NOT NULL, infected INTEGER NOT NULL, zombies INTEGER NOT NULL,
      cure_funding REAL, cure_allocation REAL, flask_active INTEGER, flask_inactive INTEGER,
      flask_destroyed INTEGER, public_order REAL,
      PRIMARY KEY (session_id, day, country_id));
    CREATE TABLE government_action_events (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, country_id TEXT NOT NULL,
      event_index INTEGER NOT NULL, action_id TEXT NOT NULL, turn INTEGER NOT NULL,
      removed INTEGER NOT NULL);
    INSERT INTO game_sessions VALUES ('legacy-session', '2026-09-01T00:00:00Z', NULL, 10, 10);
    INSERT INTO daily_snapshots VALUES
      ('legacy-session', 10, '2026-09-01T00:00:00Z', '2027-01-11', 10, 11, 0, '[]');
    INSERT INTO country_snapshots
      (session_id, day, country_id, country_index, current_population,
       original_population, healthy_population, dead_population, infected, zombies)
      VALUES ('legacy-session', 10, 'egypt', 0, 100, 100, 90, 0, 10, 0);
  `);
  legacy.close();
  const db = openDatabase(databasePath);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(db.prepare<[], { version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()!.version, 6);
  assert.deepEqual(new SqliteSnapshotRepository(db).getByDay('legacy-session', 10)!.countries.map(statuses),
    [[null, null, null]]);
  assert.deepEqual(new SqliteSnapshotRepository(db).getByDay('legacy-session', 10)!.countryInfectionEvents,
    []);
});
