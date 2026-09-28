import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildApi } from '../src/api.js';
import { openDatabase } from '../src/database.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { copySnapshot } from '../src/repositories.js';
import { SqliteSessionRepository, SqliteSnapshotRepository } from '../src/sqliteRepositories.js';
import type { CountryInfectionEvent, GameSnapshot } from '../src/types.js';
import { validateSnapshot } from '../src/validateSnapshot.js';

const saudi: CountryInfectionEvent = {
  countryId: 'soudi_arabia', turn: 1, eventTurn: 1, diseaseId: 0,
};
const middleEast: CountryInfectionEvent = {
  countryId: 'middle_east', turn: 69, eventTurn: 98, diseaseId: 0,
};
const greenland: CountryInfectionEvent = {
  countryId: 'greenland', turn: 270, eventTurn: 385, diseaseId: 0,
};

function snapshot(day: number, events: CountryInfectionEvent[] = []): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10),
    diseaseTurn: day,
    eventTurn: day + 40,
    cureProgress: 0.5,
    zombieHordeEvents: [],
    countryInfectionEvents: events,
    gameMilestones: [],
    countries: [{ index: 0, id: 'soudi_arabia', currentPopulation: 100,
      originalPopulation: 100, healthyPopulation: 90, deadPopulation: 0,
      infected: 10, zombies: 0, publicOrder: null,
      borderStatus: null, airportStatus: null, portStatus: null,
      governmentActions: [], cureResearch: null }],
  };
}

test('infection validation accepts exact values, order and duplicates; missing list becomes empty', () => {
  const { countryInfectionEvents: _omitted, ...legacy } = snapshot(150);
  assert.deepEqual(validateSnapshot(legacy).countryInfectionEvents, []);
  const events = [saudi, middleEast, { ...middleEast }, greenland];
  const parsed = validateSnapshot({ ...snapshot(250), countryInfectionEvents: events });
  assert.deepEqual(parsed.countryInfectionEvents, events);
  assert.equal(parsed.countryInfectionEvents.length, 4);
  const copy = copySnapshot(parsed);
  copy.countryInfectionEvents[0]!.countryId = 'changed';
  assert.equal(parsed.countryInfectionEvents[0]!.countryId, 'soudi_arabia');
});

test('infection validation rejects malformed list, ID and numeric fields', () => {
  for (const invalidList of [null, {}, 'INFECT: russia', 1]) {
    assert.throws(() => validateSnapshot({ ...snapshot(150), countryInfectionEvents: invalidList }),
      /countryInfectionEvents/);
  }
  const invalid: Record<string, unknown>[] = [
    { ...saudi, countryId: '' }, { ...saudi, countryId: ' ' },
    { ...saudi, countryId: 1 }, { ...saudi, countryId: null },
    { ...saudi, turn: 1.5 }, { ...saudi, turn: '1' },
    { ...saudi, eventTurn: null }, { ...saudi, eventTurn: Number.NaN },
    { ...saudi, diseaseId: Number.POSITIVE_INFINITY },
    { ...saudi, diseaseId: 9_007_199_254_740_992 },
  ];
  for (const event of invalid) {
    assert.throws(() => validateSnapshot({ ...snapshot(150), countryInfectionEvents: [event] }),
      /countryInfectionEvents\[0\]/);
  }
});

test('daily SQLite upsert stores and replaces the entire ordered infection list', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const sessions = new SqliteSessionRepository(db);
  const snapshots = new SqliteSnapshotRepository(db);
  sessions.save({ id: 'game', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 150, lastDay: 150 });
  snapshots.save({ sessionId: 'game', ...snapshot(150, [saudi, middleEast, middleEast]) });
  assert.deepEqual(snapshots.getByDay('game', 150)?.countryInfectionEvents,
    [saudi, middleEast, middleEast]);
  snapshots.save({ sessionId: 'game', ...snapshot(150, [saudi]) });
  assert.deepEqual(snapshots.getByDay('game', 150)?.countryInfectionEvents, [saudi]);
  assert.deepEqual(db.prepare('SELECT country_infection_events_json FROM daily_snapshots').all(),
    [{ country_infection_events_json: JSON.stringify([saudi]) }]);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM daily_snapshots').get() as { count: number }).count, 1);

  db.prepare(`INSERT INTO daily_snapshots
    (session_id, day, captured_at, game_date, disease_turn, event_turn, cure_progress)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('game', 151, '2026-09-23T00:00:00Z',
    '2027-06-01', 151, 191, 0);
  assert.deepEqual(snapshots.getByDay('game', 151)?.countryInfectionEvents, []);
});

test('reopened SQLite and live/history APIs keep each day’s infection list isolated', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-infection-test-'));
  const databasePath = path.join(directory, 'history.sqlite');
  let db = openDatabase(databasePath);
  t.after(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  let sessions = new SqliteSessionRepository(db);
  let snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'game' });
  const day150 = validateSnapshot(snapshot(150, [saudi, middleEast]));
  const day250 = validateSnapshot(snapshot(250, [saudi, middleEast, middleEast, greenland]));
  await tracker.handleSnapshot(day150);
  await tracker.handleSnapshot(day250);
  await tracker.flush();
  db.close();

  db = openDatabase(databasePath);
  sessions = new SqliteSessionRepository(db);
  snapshots = new SqliteSnapshotRepository(db);
  const resumed = new GameSessionTracker({ sessions, snapshots });
  await resumed.initialize();
  assert.deepEqual(snapshots.getByDay('game', 150)?.countryInfectionEvents, day150.countryInfectionEvents);
  assert.deepEqual(snapshots.getByDay('game', 250)?.countryInfectionEvents, day250.countryInfectionEvents);
  const app = buildApi({ tracker: resumed, sessions, snapshots,
    collector: { getStatus: () => ({ state: 'running', pid: 1, startedAt: null,
      lastSnapshotAt: day250.capturedAt, lastDiseaseTurn: 250, lastError: null, exit: null }),
    getLatestSnapshot: () => day250 },
    liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
  t.after(() => app.close());
  const live = await app.inject('/api/v1/live');
  const earlier = await app.inject('/api/v1/sessions/game/days/150');
  const later = await app.inject('/api/v1/sessions/game/days/250');
  assert.equal(live.statusCode, 200);
  assert.equal(earlier.statusCode, 200);
  assert.equal(later.statusCode, 200);
  assert.deepEqual(live.json().snapshot.countryInfectionEvents, day250.countryInfectionEvents);
  assert.deepEqual(earlier.json().countryInfectionEvents, day150.countryInfectionEvents);
  assert.deepEqual(later.json().countryInfectionEvents, day250.countryInfectionEvents);
  assert.equal(earlier.json().countryInfectionEvents.length, 2);
  assert.equal(later.json().countryInfectionEvents.length, 4);
});
