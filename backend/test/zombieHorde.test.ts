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
import type { GameSnapshot, ZombieHordeEvent } from '../src/types.js';
import { validateSnapshot } from '../src/validateSnapshot.js';

const dispatch: ZombieHordeEvent = {
  turn: 100, eventTurn: 140, diseaseId: 0,
  sourceCountryId: 'soudi_arabia', destinationCountryId: 'sudan', zombies: 77868,
  vehicleId: 1389, arrivalTurn: null, arrivalEventTurn: null,
};
const arrived: ZombieHordeEvent = { ...dispatch, arrivalTurn: 102, arrivalEventTurn: 145 };

function snapshot(day: number, events: ZombieHordeEvent[] = []): GameSnapshot {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, 0, day)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10),
    diseaseTurn: day,
    eventTurn: day + 40,
    cureProgress: 0.5,
    zombieHordeEvents: events,
    countryInfectionEvents: [],
    countries: [{ index: 0, id: 'soudi_arabia', currentPopulation: 100,
      originalPopulation: 100, healthyPopulation: 90, deadPopulation: 0,
      infected: 10, zombies: 0, publicOrder: null,
      borderStatus: null, airportStatus: null, portStatus: null,
      governmentActions: [], cureResearch: null }],
  };
}

test('legacy collector payloads normalize absent horde fields without changing order', () => {
  const base = snapshot(100);
  const { zombieHordeEvents: _omitted, ...legacySnapshot } = base;
  assert.deepEqual(validateSnapshot(legacySnapshot).zombieHordeEvents, []);

  const { vehicleId: _vehicle, arrivalTurn: _turn, arrivalEventTurn: _eventTurn, ...legacyEvent } = dispatch;
  const normalized = validateSnapshot({ ...base, zombieHordeEvents: [legacyEvent, legacyEvent] });
  assert.deepEqual(normalized.zombieHordeEvents, [
    { ...legacyEvent, vehicleId: null, arrivalTurn: null, arrivalEventTurn: null },
    { ...legacyEvent, vehicleId: null, arrivalTurn: null, arrivalEventTurn: null },
  ]);
});

test('collector validation preserves dispatch, arrival, duplicates and replay order', () => {
  const events = [dispatch, { ...dispatch }, arrived, { ...dispatch, eventTurn: 139 }];
  const parsed = validateSnapshot(snapshot(102, events));
  assert.deepEqual(parsed.zombieHordeEvents, events);
  assert.equal(parsed.zombieHordeEvents.length, 4);
  assert.equal(parsed.zombieHordeEvents[0]!.arrivalTurn, null);
  assert.equal(parsed.zombieHordeEvents[2]!.arrivalEventTurn, 145);
  const copied = copySnapshot(parsed);
  copied.zombieHordeEvents[0]!.vehicleId = 999;
  assert.equal(parsed.zombieHordeEvents[0]!.vehicleId, 1389);
});

test('malformed horde entries reject the collector snapshot with a field error', () => {
  const invalid: Record<string, unknown>[] = [
    { ...dispatch, turn: -1 },
    { ...dispatch, eventTurn: -1 },
    { ...dispatch, diseaseId: -1 },
    { ...dispatch, sourceCountryId: ' ' },
    { ...dispatch, destinationCountryId: '' },
    { ...dispatch, zombies: -1 },
    { ...dispatch, zombies: 1.5 },
    { ...dispatch, vehicleId: -1 },
    { ...dispatch, arrivalTurn: 99 },
    { ...dispatch, arrivalEventTurn: -1 },
    { ...dispatch, arrivalTurn: '102' },
  ];
  for (const event of invalid) {
    assert.throws(() => validateSnapshot({ ...snapshot(100), zombieHordeEvents: [event] }),
      /zombieHordeEvents\[0\]/);
  }
  assert.throws(() => validateSnapshot({ ...snapshot(100), zombieHordeEvents: {} }),
    /zombieHordeEvents/);
});

test('SQLite daily upsert replaces the whole ordered horde list without extra rows', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const sessions = new SqliteSessionRepository(db);
  const snapshots = new SqliteSnapshotRepository(db);
  sessions.save({ id: 'game', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 100, lastDay: 100 });
  snapshots.save({ sessionId: 'game', ...snapshot(100, [dispatch, dispatch]) });
  snapshots.save({ sessionId: 'game', ...snapshot(100, [arrived]) });
  assert.deepEqual(snapshots.getByDay('game', 100)?.zombieHordeEvents, [arrived]);
  assert.deepEqual(db.prepare('SELECT zombie_horde_events_json FROM daily_snapshots').all(),
    [{ zombie_horde_events_json: JSON.stringify([arrived]) }]);
});

test('SQLite and live/history APIs retain each day’s exact lifecycle state after reopen', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-horde-test-'));
  const databasePath = path.join(directory, 'history.sqlite');
  let db = openDatabase(databasePath);
  t.after(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  let sessions = new SqliteSessionRepository(db);
  let snapshots = new SqliteSnapshotRepository(db);
  sessions.save({ id: 'game', startedAt: '2026-09-23T00:00:00Z', endedAt: null,
    firstDay: 100, lastDay: 102 });
  const day100 = snapshot(100, [dispatch, { ...dispatch }]);
  const day102 = snapshot(102, [arrived, { ...dispatch }]);
  snapshots.save({ sessionId: 'game', ...day100 });
  snapshots.save({ sessionId: 'game', ...day102 });
  db.close();

  db = openDatabase(databasePath);
  sessions = new SqliteSessionRepository(db);
  snapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({ sessions, snapshots });
  await tracker.initialize();
  const app = buildApi({ tracker, sessions, snapshots,
    collector: { getStatus: () => ({ state: 'running', pid: 1, startedAt: null,
      lastSnapshotAt: day102.capturedAt, lastDiseaseTurn: 102, lastError: null, exit: null }),
      getLatestSnapshot: () => day102 },
    liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
  t.after(() => app.close());

  const live = await app.inject('/api/v1/live');
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json().snapshot.zombieHordeEvents, day102.zombieHordeEvents);
  const earlier = await app.inject('/api/v1/sessions/game/days/100');
  const later = await app.inject('/api/v1/sessions/game/days/102');
  assert.equal(earlier.statusCode, 200);
  assert.equal(later.statusCode, 200);
  assert.deepEqual(earlier.json().zombieHordeEvents, day100.zombieHordeEvents);
  assert.deepEqual(later.json().zombieHordeEvents, day102.zombieHordeEvents);
  assert.equal(earlier.json().zombieHordeEvents[0].arrivalTurn, null);
  assert.equal(later.json().zombieHordeEvents[0].arrivalTurn, 102);
  assert.equal(later.json().zombieHordeEvents[0].arrivalEventTurn, 145);
  assert.equal(earlier.json().zombieHordeEvents.length, 2);
});
