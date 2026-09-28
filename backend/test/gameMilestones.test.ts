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
import type { GameMilestone, GameSnapshot } from '../src/types.js';
import { validateSnapshot } from '../src/validateSnapshot.js';

const liveMilestones: GameMilestone[] = [
  { type: 'virus_dna_detected', turn: 11, countryId: null, diseaseId: 0 },
  { type: 'more_infectious_than_tb', turn: 132, countryId: null, diseaseId: 0 },
  { type: 'more_infectious_than_hiv', turn: 147, countryId: null, diseaseId: 0 },
  { type: 'disease_detected', turn: 150, countryId: 'soudi_arabia', diseaseId: 0 },
  { type: 'first_death', turn: 172, countryId: 'east_africa', diseaseId: 0 },
  { type: 'more_infectious_than_common_cold', turn: 200, countryId: null, diseaseId: 0 },
  { type: 'worse_than_black_death', turn: 286, countryId: null, diseaseId: 0 },
  { type: 'worse_than_spanish_flu', turn: 295, countryId: null, diseaseId: 0 },
  { type: 'worse_than_smallpox', turn: 316, countryId: null, diseaseId: 0 },
];

function snapshot(day: number, gameMilestones: GameMilestone[] = []): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10),
    diseaseTurn: day,
    eventTurn: day + 40,
    cureProgress: 0.5,
    zombieHordeEvents: [],
    countryInfectionEvents: [],
    gameMilestones,
    countries: [{ index: 0, id: 'soudi_arabia', currentPopulation: 100,
      originalPopulation: 100, healthyPopulation: 90, deadPopulation: 0,
      infected: 10, zombies: 0, publicOrder: null,
      borderStatus: null, airportStatus: null, portStatus: null,
      governmentActions: [], cureResearch: null }],
  };
}

test('all nine milestone types validate, preserving order, duplicates, IDs and numeric values', () => {
  const { gameMilestones: _omitted, ...legacy } = snapshot(150);
  assert.deepEqual(validateSnapshot(legacy).gameMilestones, []);
  const ordered = [liveMilestones[0]!, ...liveMilestones, { ...liveMilestones[3]!, diseaseId: -7 }];
  const parsed = validateSnapshot({ ...snapshot(316), gameMilestones: ordered });
  assert.deepEqual(parsed.gameMilestones, ordered);
  assert.equal(parsed.gameMilestones.length, 11);
  assert.equal(parsed.gameMilestones[4]!.countryId, 'soudi_arabia');
  const copy = copySnapshot(parsed);
  copy.gameMilestones[0]!.turn = 999;
  assert.equal(parsed.gameMilestones[0]!.turn, 11);
});

test('malformed milestone lists, types, numbers and country contexts are rejected', () => {
  for (const invalidList of [null, {}, 'news', 1]) {
    assert.throws(() => validateSnapshot({ ...snapshot(150), gameMilestones: invalidList }),
      /gameMilestones/);
  }
  const global = liveMilestones[0]!;
  const country = liveMilestones[3]!;
  const invalid: unknown[] = [
    null, [], 'headline',
    { ...global, type: 'unknown' }, { ...global, type: 'Virus_DNA_Detected' },
    { ...global, turn: 1.5 }, { ...global, turn: Number.NaN },
    { ...global, turn: Number.MAX_SAFE_INTEGER + 1 }, { ...global, turn: '11' },
    { ...global, diseaseId: 1.5 }, { ...global, diseaseId: Number.POSITIVE_INFINITY },
    { ...global, diseaseId: Number.MAX_SAFE_INTEGER + 1 },
    { ...global, countryId: 'soudi_arabia' }, { ...global, countryId: undefined },
    { ...country, countryId: null }, { ...country, countryId: '' },
    { ...country, countryId: ' ' }, { ...country, countryId: 3 },
    { ...liveMilestones[4]!, countryId: null },
  ];
  for (const milestone of invalid) {
    assert.throws(() => validateSnapshot({ ...snapshot(150), gameMilestones: [milestone] }),
      /gameMilestones\[0\]/);
  }
});

test('SQLite daily upsert retains exact milestone order and duplicates without later-day enrichment', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const sessions = new SqliteSessionRepository(db);
  const snapshots = new SqliteSnapshotRepository(db);
  sessions.save({ id: 'game', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 150, lastDay: 316 });
  const firstDay = [liveMilestones[0]!, liveMilestones[0]!, liveMilestones[3]!];
  snapshots.save({ sessionId: 'game', ...snapshot(150, firstDay) });
  snapshots.save({ sessionId: 'game', ...snapshot(316, liveMilestones) });
  assert.deepEqual(snapshots.getByDay('game', 150)?.gameMilestones, firstDay);
  assert.deepEqual(snapshots.getByDay('game', 316)?.gameMilestones, liveMilestones);
  snapshots.save({ sessionId: 'game', ...snapshot(316, [liveMilestones[8]!]) });
  assert.deepEqual(snapshots.getByDay('game', 316)?.gameMilestones, [liveMilestones[8]!]);
  assert.deepEqual(snapshots.getByDay('game', 150)?.gameMilestones, firstDay);
  assert.deepEqual(db.prepare('SELECT day, game_milestones_json FROM daily_snapshots ORDER BY day').all(), [
    { day: 150, game_milestones_json: JSON.stringify(firstDay) },
    { day: 316, game_milestones_json: JSON.stringify([liveMilestones[8]!]) },
  ]);
  const invalid = { sessionId: 'game', ...snapshot(150, liveMilestones) };
  invalid.countries.push({ ...invalid.countries[0]!, index: 0 });
  assert.throws(() => snapshots.save(invalid), /UNIQUE/);
  assert.deepEqual(snapshots.getByDay('game', 150)?.gameMilestones, firstDay,
    'a failed country write must roll back the milestone JSON update');
});

test('Migration 7 upgrades a version-6 historical row to an empty milestone list', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-milestones-v6-'));
  const databasePath = path.join(directory, 'history.sqlite');
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, '2026-09-01'), (2, '2026-09-01'),
      (3, '2026-09-01'), (4, '2026-09-01'), (5, '2026-09-01'), (6, '2026-09-01');
    CREATE TABLE game_sessions (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
      first_day INTEGER NOT NULL, last_day INTEGER NOT NULL);
    CREATE TABLE daily_snapshots (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, captured_at TEXT NOT NULL,
      game_date TEXT NOT NULL, disease_turn INTEGER NOT NULL, event_turn INTEGER NOT NULL,
      cure_progress REAL NOT NULL, zombie_horde_events_json TEXT NOT NULL DEFAULT '[]',
      country_infection_events_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (session_id, day));
    CREATE TABLE country_snapshots (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, country_id TEXT NOT NULL,
      country_index INTEGER NOT NULL, current_population INTEGER NOT NULL,
      original_population INTEGER NOT NULL, healthy_population INTEGER NOT NULL,
      dead_population INTEGER NOT NULL, infected INTEGER NOT NULL, zombies INTEGER NOT NULL,
      cure_funding REAL, cure_allocation REAL, flask_active INTEGER, flask_inactive INTEGER,
      flask_destroyed INTEGER, public_order REAL, border_status TEXT, airport_status TEXT,
      port_status TEXT, PRIMARY KEY (session_id, day, country_id));
    CREATE TABLE government_action_events (
      session_id TEXT NOT NULL, day INTEGER NOT NULL, country_id TEXT NOT NULL,
      event_index INTEGER NOT NULL, action_id TEXT NOT NULL, turn INTEGER NOT NULL,
      removed INTEGER NOT NULL);
    INSERT INTO game_sessions VALUES ('legacy', '2026-09-01T00:00:00Z', NULL, 150, 150);
    INSERT INTO daily_snapshots VALUES
      ('legacy', 150, '2026-09-01T00:00:00Z', '2027-05-31', 150, 190, 0, '[]', '[]');
  `);
  legacy.close();
  const db = openDatabase(databasePath);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(db.prepare<[], { version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get()!.version, 7);
  assert.deepEqual(new SqliteSnapshotRepository(db).getByDay('legacy', 150)?.gameMilestones, []);
});

test('reopened SQLite and LIVE/history APIs preserve only each selected day’s milestones', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-milestones-api-'));
  const databasePath = path.join(directory, 'history.sqlite');
  let db = openDatabase(databasePath);
  t.after(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  let sessions = new SqliteSessionRepository(db);
  let snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'game' });
  const oldDay = validateSnapshot(snapshot(150, liveMilestones.slice(0, 4)));
  const newDay = validateSnapshot(snapshot(316, liveMilestones));
  await tracker.handleSnapshot(oldDay);
  await tracker.handleSnapshot(newDay);
  await tracker.flush();
  db.close();

  db = openDatabase(databasePath);
  sessions = new SqliteSessionRepository(db);
  snapshots = new SqliteSnapshotRepository(db);
  const resumed = new GameSessionTracker({ sessions, snapshots });
  await resumed.initialize();
  assert.deepEqual(snapshots.getByDay('game', 150)?.gameMilestones, oldDay.gameMilestones);
  assert.deepEqual(snapshots.getByDay('game', 316)?.gameMilestones, newDay.gameMilestones);
  const app = buildApi({ tracker: resumed, sessions, snapshots,
    collector: { getStatus: () => ({ state: 'running', pid: 1, startedAt: null,
      lastSnapshotAt: newDay.capturedAt, lastDiseaseTurn: 316, lastError: null, exit: null }),
    getLatestSnapshot: () => newDay },
    liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
  t.after(() => app.close());
  const live = await app.inject('/api/v1/live');
  const earlier = await app.inject('/api/v1/sessions/game/days/150');
  const later = await app.inject('/api/v1/sessions/game/days/316');
  assert.equal(live.statusCode, 200);
  assert.equal(earlier.statusCode, 200);
  assert.equal(later.statusCode, 200);
  assert.deepEqual(live.json().snapshot.gameMilestones, newDay.gameMilestones);
  assert.deepEqual(earlier.json().gameMilestones, oldDay.gameMilestones);
  assert.deepEqual(later.json().gameMilestones, newDay.gameMilestones);
  assert.equal(earlier.json().gameMilestones.length, 4);
  assert.equal(later.json().gameMilestones.length, 9);
});
