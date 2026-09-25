import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { buildApi } from '../src/api.js';
import { loadApiConfig } from '../src/apiConfig.js';
import { openDatabase } from '../src/database.js';
import { GameSessionTracker } from '../src/GameSessionTracker.js';
import { InMemorySessionRepository, InMemorySnapshotRepository } from '../src/repositories.js';
import { SqliteSessionRepository, SqliteSnapshotRepository } from '../src/sqliteRepositories.js';
import type { CollectorStatus, GameSession, GameSnapshot, HistoricalSnapshot } from '../src/types.js';

function snapshot(day: number, revision = 1, countries = 2): GameSnapshot {
  const ids = ['soudi_arabia', 'ukraine'];
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day % 60, revision)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2026, 8, 23 + day)).toISOString().slice(0, 10),
    diseaseTurn: day + 200,
    eventTurn: revision + 300,
    cureProgress: revision * 12.5,
    countries: Array.from({ length: countries }, (_, index) => ({
      index,
      id: ids[index] ?? `country_${index}`,
      // Deliberately not an additive population invariant.
      currentPopulation: 400 + index,
      originalPopulation: 1000 + index,
      healthyPopulation: 700 + index - revision,
      infected: 200 + index + revision,
      deadPopulation: 50 + index,
      zombies: 3 + index,
    })),
  };
}

function session(id: string, startedAt: string, firstDay = 0): GameSession {
  return { id, startedAt, endedAt: null, firstDay, lastDay: firstDay };
}

function historical(sessionId: string, day: number, revision = 1): HistoricalSnapshot {
  return { sessionId, ...snapshot(day, revision) };
}

function fixture(t: TestContext) {
  const sessions = new InMemorySessionRepository();
  const snapshots = new InMemorySnapshotRepository();
  const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'live-session' });
  const status: CollectorStatus = {
    state: 'stopped', pid: null, startedAt: null, lastSnapshotAt: null,
    lastDiseaseTurn: null, lastError: null, exit: null,
  };
  let latestSnapshot: GameSnapshot | null = null;
  const errors: string[] = [];
  const app = buildApi({ tracker, sessions, snapshots, collector: {
    getStatus: () => status,
    getLatestSnapshot: () => latestSnapshot,
  }, liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} },
    logError: (message) => errors.push(message) });
  t.after(() => app.close());
  return { app, sessions, snapshots, tracker, status, errors,
    setLatestSnapshot(value: GameSnapshot) { latestSnapshot = value; } };
}

test('API defaults are loopback:3001 and config is validated', () => {
  assert.deepEqual(loadApiConfig({}), { host: '127.0.0.1', port: 3001 });
  assert.deepEqual(loadApiConfig({ PLAGUE_API_HOST: '::1', PLAGUE_API_PORT: '4002' }),
    { host: '::1', port: 4002 });
  assert.throws(() => loadApiConfig({ PLAGUE_API_PORT: '-1' }));
  assert.throws(() => loadApiConfig({ PLAGUE_API_HOST: 'bad/host' }));
});

test('health is cheap and live without a collector is a normal null state', async (t) => {
  const { app, status } = fixture(t);
  const health = await app.inject('/api/v1/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });
  status.lastError = 'collector unavailable';
  const live = await app.inject('/api/v1/live');
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), {
    collector: { running: false, lastError: 'collector unavailable' },
    session: null,
    snapshot: null,
  });
});

test('live returns the latest same-day snapshot while collector is running', async (t) => {
  const { app, tracker, status, setLatestSnapshot } = fixture(t);
  status.state = 'running';
  await tracker.handleSnapshot(snapshot(10, 1));
  await tracker.handleSnapshot(snapshot(10, 2));
  const beforeFirstCollectorObservation = await app.inject('/api/v1/live');
  assert.equal(beforeFirstCollectorObservation.json().snapshot, null);
  setLatestSnapshot(snapshot(10, 2));
  const live = await app.inject('/api/v1/live');
  assert.equal(live.statusCode, 200);
  const body = live.json();
  assert.equal(body.collector.running, true);
  assert.equal(body.session.id, 'live-session');
  assert.equal(body.snapshot.day, 10);
  assert.equal(body.snapshot.eventTurn, 302);
  assert.equal(body.snapshot.countries[0].id, 'soudi_arabia');
});

test('session list is newest-first with summary counts and no country payload', async (t) => {
  const { app, sessions, snapshots } = fixture(t);
  sessions.save(session('older', '2026-09-01T00:00:00.000Z', 100));
  sessions.save(session('newer', '2026-10-01T00:00:00.000Z', 0));
  snapshots.save(historical('older', 100));
  snapshots.save(historical('older', 104));
  snapshots.save(historical('newer', 0));
  const response = await app.inject('/api/v1/sessions');
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.map((item: { id: string }) => item.id), ['newer', 'older']);
  assert.equal(body[1].snapshotCount, 2);
  assert.equal(body[1].isOpen, true);
  assert.equal(body[1].firstGameDate, snapshot(100).gameDate);
  assert.equal(body[1].lastGameDate, snapshot(104).gameDate);
  assert.equal('countries' in body[1], false);
});

test('session detail has metadata/range and unknown session returns JSON 404', async (t) => {
  const { app, sessions, snapshots } = fixture(t);
  sessions.save(session('game-1', '2026-09-01T00:00:00.000Z', 100));
  snapshots.save(historical('game-1', 100));
  snapshots.save(historical('game-1', 104));
  const detail = await app.inject('/api/v1/sessions/game-1');
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().session.snapshotCount, 2);
  assert.equal(detail.json().session.firstDay, 100);
  assert.equal(detail.json().range.lastGameDate, snapshot(104).gameDate);
  for (const url of [
    '/api/v1/sessions/unknown',
    '/api/v1/sessions/unknown/history',
    '/api/v1/sessions/unknown/countries',
    '/api/v1/sessions/unknown/countries/ukraine/history',
  ]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: { code: 'SESSION_NOT_FOUND', message: 'Session not found' },
    });
  }
});

test('session countries are ordered, unique, raw, and independent of live state', async (t) => {
  const { app, sessions, snapshots } = fixture(t);
  sessions.save(session('empty', '2026-09-01T00:00:00.000Z'));
  sessions.save(session('game-1', '2026-09-02T00:00:00.000Z'));
  const empty = await app.inject('/api/v1/sessions/empty/countries');
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { sessionId: 'empty', countries: [] });

  const first = historical('game-1', 10);
  first.countries = [
    { ...first.countries[0]!, index: 3, id: 'soudi_arabia' },
    { ...first.countries[1]!, index: 1, id: 'morroco' },
  ];
  snapshots.save(first);
  snapshots.save({ ...first, day: 11, countries: [
    { ...first.countries[0]!, index: 3 },
    { ...first.countries[1]!, index: 1 },
    { ...first.countries[0]!, index: 2, id: 'philipines' },
    { ...first.countries[0]!, index: 4, id: 'balcan_states' },
  ] });
  const response = await app.inject('/api/v1/sessions/game-1/countries');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { sessionId: 'game-1', countries: [
    { id: 'morroco', index: 1 },
    { id: 'philipines', index: 2 },
    { id: 'soudi_arabia', index: 3 },
    { id: 'balcan_states', index: 4 },
  ] });
});

test('global history is day-ordered, gap-preserving, aggregated, and deduplicated', async (t) => {
  const { app, sessions, snapshots } = fixture(t);
  sessions.save(session('game-1', '2026-09-01T00:00:00.000Z', 100));
  snapshots.save(historical('game-1', 104));
  snapshots.save(historical('game-1', 100));
  snapshots.save(historical('game-1', 101));
  snapshots.save(historical('game-1', 100, 2)); // upsert replaces the first version.
  const response = await app.inject('/api/v1/sessions/game-1/history');
  assert.equal(response.statusCode, 200);
  const points = response.json().history;
  assert.deepEqual(points.map((item: { day: number }) => item.day), [100, 101, 104]);
  assert.equal(points[0].diseaseTurn, 300); // diseaseTurn is not the day key.
  assert.equal(points[0].eventTurn, 302);
  assert.equal(points[0].cureProgress, 25);
  assert.equal(points[0].healthy, (700 - 2) + (701 - 2));
  assert.equal(points[0].infected, (200 + 2) + (201 + 2));
  assert.equal(points[0].dead, 50 + 51);
  assert.equal(points[0].zombies, 3 + 4);
  assert.equal(points[0].originalPopulation, 1000 + 1001);
  assert.equal('countries' in points[0], false);
});

test('full day endpoint returns the exact observed snapshot and ordered raw country IDs', async (t) => {
  const { app, sessions, snapshots } = fixture(t);
  sessions.save(session('game-1', '2026-09-01T00:00:00.000Z', 100));
  const saved = historical('game-1', 104, 2);
  saved.countries = [
    { ...saved.countries[0]!, index: 3, id: 'soudi_arabia' },
    { ...saved.countries[1]!, index: 1, id: 'morroco' },
    { ...saved.countries[0]!, index: 2, id: 'philipines' },
    { ...saved.countries[0]!, index: 4, id: 'balcan_states' },
  ];
  snapshots.save(historical('game-1', 100));
  snapshots.save(saved);
  const response = await app.inject('/api/v1/sessions/game-1/days/104');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ...saved, countries: [...saved.countries].sort((a, b) => a.index - b.index) });
  assert.deepEqual(response.json().countries.map((item: { id: string }) => item.id),
    ['morroco', 'philipines', 'soudi_arabia', 'balcan_states']);
  const gap = await app.inject('/api/v1/sessions/game-1/days/101');
  assert.equal(gap.statusCode, 404);
  assert.equal(gap.json().error.code, 'SNAPSHOT_NOT_FOUND');
  const unknown = await app.inject('/api/v1/sessions/unknown/days/104');
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, 'SESSION_NOT_FOUND');
  for (const day of ['-1', '1.5', 'abc', '1e2', '9007199254740992']) {
    const invalid = await app.inject(`/api/v1/sessions/game-1/days/${day}`);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'INVALID_DAY');
  }
});

test('country history preserves raw IDs, orders days, and rejects unknown country', async (t) => {
  const { app, sessions, snapshots } = fixture(t);
  sessions.save(session('game-1', '2026-09-01T00:00:00.000Z', 100));
  snapshots.save(historical('game-1', 104));
  snapshots.save(historical('game-1', 100));
  const response = await app.inject('/api/v1/sessions/game-1/countries/soudi_arabia/history');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().countryId, 'soudi_arabia');
  assert.deepEqual(response.json().history.map((item: { day: number }) => item.day), [100, 104]);
  assert.equal(response.json().history[0].currentPopulation, 400);
  const missing = await app.inject('/api/v1/sessions/game-1/countries/saudi_arabia/history');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'COUNTRY_NOT_FOUND');
});

test('malformed routes and unexpected errors use sanitized JSON errors', async (t) => {
  const { app, sessions, errors } = fixture(t);
  const encodedControl = await app.inject('/api/v1/sessions/%00');
  assert.equal(encodedControl.statusCode, 400);
  assert.equal(encodedControl.json().error.code, 'INVALID_PARAMETER');
  const malformed = await app.inject('/api/v1/sessions/%ZZ');
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, 'INVALID_REQUEST');
  const unknownRoute = await app.inject('/api/v1/not-a-route');
  assert.equal(unknownRoute.statusCode, 404);
  assert.equal(unknownRoute.json().error.code, 'NOT_FOUND');
  const original = sessions.getById.bind(sessions);
  sessions.getById = () => { throw new Error('secret database failure'); };
  const failure = await app.inject('/api/v1/sessions/any');
  assert.equal(failure.statusCode, 500);
  assert.deepEqual(failure.json(), {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
  assert.ok(errors.some((message) => message.includes('secret database failure')));
  sessions.getById = original;
});

test('SQLite reopen keeps API history and uses aggregate/read queries for 350 days', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plague-api-test-'));
  const databasePath = path.join(directory, 'api.sqlite');
  let db = openDatabase(databasePath);
  t.after(() => {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const sessions = new SqliteSessionRepository(db);
  const snapshots = new SqliteSnapshotRepository(db);
  sessions.save(session('long-game', '2026-09-01T00:00:00.000Z'));
  for (let day = 0; day < 350; day++) {
    snapshots.save({ sessionId: 'long-game', ...snapshot(day, 1, 58) });
  }
  db.close();
  db = openDatabase(databasePath);
  const restoredSessions = new SqliteSessionRepository(db);
  const restoredSnapshots = new SqliteSnapshotRepository(db);
  const tracker = new GameSessionTracker({ sessions: restoredSessions, snapshots: restoredSnapshots });
  const status: CollectorStatus = {
    state: 'stopped', pid: null, startedAt: null, lastSnapshotAt: null,
    lastDiseaseTurn: null, lastError: null, exit: null,
  };
  const app = buildApi({ tracker, sessions: restoredSessions, snapshots: restoredSnapshots,
    collector: { getStatus: () => status, getLatestSnapshot: () => null },
    liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
  t.after(() => app.close());
  const start = performance.now();
  const list = await app.inject('/api/v1/sessions');
  const history = await app.inject('/api/v1/sessions/long-game/history');
  const country = await app.inject('/api/v1/sessions/long-game/countries/soudi_arabia/history');
  const countries = await app.inject('/api/v1/sessions/long-game/countries');
  const elapsed = Math.round(performance.now() - start);
  assert.equal(list.statusCode, 200);
  assert.equal(list.json()[0].snapshotCount, 350);
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().history.length, 350);
  assert.equal(country.statusCode, 200);
  assert.equal(country.json().history.length, 350);
  assert.equal(countries.statusCode, 200);
  assert.equal(countries.json().countries.length, 58);
  assert.equal(history.json().history[349].day, 349);
  const first = history.json().history[0];
  assert.equal(first.diseaseTurn, 200);
  assert.equal(first.cureProgress, 12.5);
  assert.equal(first.healthy, 58 * 699 + 1653);
  assert.equal(first.infected, 58 * 201 + 1653);
  assert.equal(first.dead, 58 * 50 + 1653);
  assert.equal(first.originalPopulation, 58 * 1000 + 1653);
  assert.equal(country.json().history[0].currentPopulation, 400);
  console.log(`[api:performance] 350 days x 58 countries: sessions + global history + one country = ${elapsed} ms`);
});
