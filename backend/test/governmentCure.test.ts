import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { buildApi } from '../src/api.js';
import { openDatabase } from '../src/database.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { SqliteSessionRepository, SqliteSnapshotRepository } from '../src/sqliteRepositories.js';
import type { CountrySnapshot, GameSnapshot } from '../src/types.js';
import { validateSnapshot } from '../src/validateSnapshot.js';

function temporaryPath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-government-cure-'));
  return path.join(directory, 'history.sqlite');
}

function country(index: number, id: string, funding: number, day: number): CountrySnapshot {
  return { index, id, currentPopulation: 900, originalPopulation: 1000,
    healthyPopulation: 700, infected: 200, deadPopulation: 100, zombies: 0,
    publicOrder: null,
    borderStatus: null, airportStatus: null, portStatus: null,
    governmentActions: index === 0 ? [
      { id: 'infectious_disease_teams__mobilised', turn: day - 1, removed: true },
      { id: 'research_funding_10', turn: day, removed: false },
      { id: 'unknown_modded_action', turn: day, removed: false },
    ] : [],
    cureResearch: { funding, allocation: index === 0 ? 0.4 : 0.2, rank: null,
      flasks: { active: 4 + index, inactive: 3, destroyed: 2 } } };
}

function snapshot(day: number, firstFunding: number, secondFunding: number): GameSnapshot {
  return { capturedAt: `2026-09-23T00:00:${day - 100}0Z`, day,
    gameDate: day === 100 ? '2027-01-01' : '2027-01-05',
    diseaseTurn: day, eventTurn: day + 5, cureProgress: day - 90,
    zombieHordeEvents: [],
    countryInfectionEvents: [],
    gameMilestones: [],
    countries: [country(0, 'morroco', firstFunding, day),
      country(1, 'soudi_arabia', secondFunding, day), country(2, 'peru', 0, day)] };
}

test('collector payload validation preserves action IDs and cure floats, derives same-day rank', () => {
  const parsed = validateSnapshot(snapshot(100, 1245.63, 2000));
  assert.deepEqual(parsed.countries[0]!.governmentActions, [
    { id: 'infectious_disease_teams__mobilised', turn: 99, removed: true },
    { id: 'research_funding_10', turn: 100, removed: false },
    { id: 'unknown_modded_action', turn: 100, removed: false },
  ]);
  assert.equal(parsed.countries[0]!.cureResearch?.funding, 1245.63);
  assert.equal(parsed.countries[0]!.cureResearch?.allocation, 0.4);
  assert.deepEqual(parsed.countries[0]!.cureResearch?.flasks, { active: 4, inactive: 3, destroyed: 2 });
  assert.deepEqual(parsed.countries.map((item) => item.cureResearch?.rank), [2, 1, null]);

  const duplicates = snapshot(100, 10, 5);
  duplicates.countries[0]!.governmentActions.push(
    { ...duplicates.countries[0]!.governmentActions[0]! });
  assert.equal(validateSnapshot(duplicates).countries[0]!.governmentActions.length, 4);

  const tied = validateSnapshot(snapshot(100, 20, 20));
  assert.deepEqual(tied.countries.map((item) => item.cureResearch?.rank), [1, 2, null]);
  const incomplete = snapshot(100, 20, 10);
  incomplete.countries[2]!.cureResearch = null;
  assert.deepEqual(validateSnapshot(incomplete).countries.map((item) => item.cureResearch?.rank),
    [null, null, undefined]);
  const rawEvent = snapshot(100, 1, 2);
  rawEvent.countries[0]!.governmentActions.push({ id: '', turn: -1, removed: false });
  assert.deepEqual(validateSnapshot(rawEvent).countries[0]!.governmentActions.at(-1),
    { id: '', turn: -1, removed: false });
  const legacy = snapshot(100, 1, 2) as unknown as { countries: Record<string, unknown>[] };
  for (const item of legacy.countries) { delete item.governmentActions; delete item.cureResearch; }
  const old = validateSnapshot(legacy);
  assert.deepEqual(old.countries.map((item) => [item.governmentActions, item.cureResearch]),
    [[[], null], [[], null], [[], null]]);
});

test('invalid action and cure shapes are rejected without a government ID whitelist', () => {
  const base = snapshot(100, 10, 5);
  assert.throws(() => validateSnapshot({ ...base, countries: [{ ...base.countries[0],
    governmentActions: [{ id: 'unknown', turn: 1.5, removed: false }] }] }), /governmentActions/);
  assert.throws(() => validateSnapshot({ ...base, countries: [{ ...base.countries[0],
    governmentActions: [{ id: 'unknown', turn: 1, removed: 'false' }] }] }), /governmentActions/);
  assert.throws(() => validateSnapshot({ ...base, countries: [{ ...base.countries[0],
    cureResearch: { funding: Number.NaN, allocation: 0.2, rank: null,
      flasks: { active: 1, inactive: 1, destroyed: 1 } } }] }), /cureResearch/);
  assert.throws(() => validateSnapshot({ ...base, countries: [{ ...base.countries[0],
    cureResearch: { funding: 1, allocation: 0.2, rank: null,
      flasks: { active: -1, inactive: 1, destroyed: 1 } } }] }), /cureResearch/);
});

test('SQLite and APIs retain per-day actions and cure data without substituting current values', async (t) => {
  const databasePath = temporaryPath();
  const db = openDatabase(databasePath);
  t.after(() => { db.close(); rmSync(path.dirname(databasePath), { recursive: true, force: true }); });
  const sessions = new SqliteSessionRepository(db);
  const snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'tracked-game' });
  const day100 = validateSnapshot(snapshot(100, 1245.63, 2000));
  const day104 = validateSnapshot(snapshot(104, 3000.25, 1000));
  await tracker.handleSnapshot(day100);
  await tracker.handleSnapshot(day104);
  const app = buildApi({ tracker, sessions, snapshots,
    collector: { getStatus: () => ({ state: 'running', pid: 1, startedAt: null,
      lastSnapshotAt: null, lastDiseaseTurn: null, lastError: null, exit: null }),
      getLatestSnapshot: () => day104 },
    liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
  t.after(() => app.close());
  const live = await app.inject('/api/v1/live');
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().snapshot.countries[0].cureResearch.funding, 3000.25);
  assert.equal(live.json().snapshot.countries[0].cureResearch.rank, 1);
  assert.equal(live.json().snapshot.countries[0].governmentActions[0].turn, 103);

  const saved = await app.inject('/api/v1/sessions/tracked-game/days/100');
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().countries[0].cureResearch.funding, 1245.63);
  assert.equal(saved.json().countries[0].cureResearch.rank, 2);
  assert.deepEqual(saved.json().countries[0].cureResearch.flasks,
    { active: 4, inactive: 3, destroyed: 2 });
  assert.equal(saved.json().countries[0].governmentActions[0].removed, true);
  assert.equal(saved.json().countries[0].governmentActions[0].id,
    'infectious_disease_teams__mobilised');
  assert.equal(saved.json().countries[0].governmentActions[2].id, 'unknown_modded_action');
  assert.equal(saved.json().countries[2].cureResearch.rank, null);
  await tracker.flush();
  assert.equal(snapshots.getByDay('tracked-game', 104)?.countries[0]?.cureResearch?.rank, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM government_action_events').get() as { count: number }).count, 6);
});

test('v1 SQLite rows migrate and read with empty actions and null cure data', (t) => {
  const databasePath = temporaryPath();
  const old = new Database(databasePath);
  old.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, '2026-09-23T00:00:00Z');
    CREATE TABLE game_sessions (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
      first_day INTEGER NOT NULL, last_day INTEGER NOT NULL);
    CREATE TABLE daily_snapshots (session_id TEXT NOT NULL, day INTEGER NOT NULL,
      captured_at TEXT NOT NULL, game_date TEXT NOT NULL, disease_turn INTEGER NOT NULL,
      event_turn INTEGER NOT NULL, cure_progress REAL NOT NULL, PRIMARY KEY (session_id, day));
    CREATE TABLE country_snapshots (session_id TEXT NOT NULL, day INTEGER NOT NULL,
      country_id TEXT NOT NULL, country_index INTEGER NOT NULL, current_population INTEGER NOT NULL,
      original_population INTEGER NOT NULL, healthy_population INTEGER NOT NULL,
      dead_population INTEGER NOT NULL, infected INTEGER NOT NULL, zombies INTEGER NOT NULL,
      PRIMARY KEY (session_id, day, country_id));
    INSERT INTO game_sessions VALUES ('old', '2026-09-23T00:00:00Z', NULL, 10, 10);
    INSERT INTO daily_snapshots VALUES ('old', 10, '2026-09-23T00:00:00Z', '2027-01-01', 10, 10, 1.5);
    INSERT INTO country_snapshots VALUES ('old', 10, 'peru', 0, 90, 100, 70, 10, 20, 0);
  `);
  old.close();
  const db = openDatabase(databasePath);
  t.after(() => { db.close(); rmSync(path.dirname(databasePath), { recursive: true, force: true }); });
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
    [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }]);
  const oldSnapshot = new SqliteSnapshotRepository(db).getByDay('old', 10);
  const country = oldSnapshot?.countries[0];
  assert.deepEqual(oldSnapshot?.zombieHordeEvents, []);
  assert.deepEqual(oldSnapshot?.countryInfectionEvents, []);
  assert.deepEqual(country?.governmentActions, []);
  assert.equal(country?.cureResearch, null);
  assert.equal(country?.publicOrder, null);
  assert.equal(country?.infected, 20);
});

test('government events and cure values survive reopen and day replacement clears old events', (t) => {
  const databasePath = temporaryPath();
  let db = openDatabase(databasePath);
  t.after(() => { if (db.open) db.close(); rmSync(path.dirname(databasePath), { recursive: true, force: true }); });
  const sessions = new SqliteSessionRepository(db);
  sessions.save({ id: 'game', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 100, lastDay: 100 });
  const first = { sessionId: 'game', ...snapshot(100, 3188.2, 1000) };
  new SqliteSnapshotRepository(db).save(first);
  db.close();
  db = openDatabase(databasePath);
  let loaded = new SqliteSnapshotRepository(db).getByDay('game', 100)!;
  assert.equal(loaded.countries[0]!.cureResearch?.funding, 3188.2);
  assert.deepEqual(loaded.countries[0]!.governmentActions, first.countries[0]!.governmentActions);
  assert.equal(loaded.countries[0]!.cureResearch?.rank, 1);
  const replacement = { ...first, countries: first.countries.map((item) => ({ ...item,
    governmentActions: item.index === 0 ? [{ id: 'new_unknown_action', turn: 101, removed: true }] : [] })) };
  new SqliteSnapshotRepository(db).save(replacement);
  loaded = new SqliteSnapshotRepository(db).getByDay('game', 100)!;
  assert.deepEqual(loaded.countries[0]!.governmentActions,
    [{ id: 'new_unknown_action', turn: 101, removed: true }]);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM government_action_events').get() as { count: number }).count, 1);
});
