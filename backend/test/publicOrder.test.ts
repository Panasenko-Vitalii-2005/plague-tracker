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
import { validateSnapshot } from '../src/validateSnapshot.js';

function rawSnapshot(day: number, orders: unknown[]) {
  return {
    capturedAt: new Date(Date.UTC(2026, 8, 23, 0, day)).toISOString(),
    day,
    gameDate: new Date(Date.UTC(2027, 0, day + 1)).toISOString().slice(0, 10),
    diseaseTurn: day,
    eventTurn: day + 40,
    cureProgress: 0.5,
    zombieHordeEvents: [],
    countryInfectionEvents: [],
    gameMilestones: [],
    countries: orders.map((publicOrder, index) => ({
      index, id: ['soudi_arabia', 'russia'][index] ?? `country_${index}`,
      currentPopulation: 100, originalPopulation: 100,
      healthyPopulation: 90, deadPopulation: 0, infected: 10, zombies: 0,
      governmentActions: [], cureResearch: null, publicOrder,
    })),
  };
}

test('collector publicOrder accepts null, zero, one and exact fractions; missing normalizes to null', () => {
  const raw = rawSnapshot(10, [0.9951444, 0]);
  const { publicOrder: _omitted, ...legacy } = raw.countries[0]!;
  assert.deepEqual(validateSnapshot({ ...raw, countries: [legacy, raw.countries[1]] })
    .countries.map((country) => country.publicOrder), [null, 0]);
  assert.deepEqual(validateSnapshot(rawSnapshot(10, [null, 1]))
    .countries.map((country) => country.publicOrder), [null, 1]);
  const parsed = validateSnapshot(raw);
  assert.deepEqual(parsed.countries.map((country) => country.publicOrder), [0.9951444, 0]);
  const copied = copySnapshot(parsed);
  copied.countries[0]!.publicOrder = 0.2;
  assert.equal(parsed.countries[0]!.publicOrder, 0.9951444);
});

test('collector publicOrder rejects malformed or out-of-range values', () => {
  for (const bad of [-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, '0.5', true, {}, []]) {
    assert.throws(() => validateSnapshot(rawSnapshot(10, [bad])), /countries\[0\]\.publicOrder/);
  }
});

test('SQLite and live/history APIs preserve each country and each day without rounding or retroactive changes',
  async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'plague-public-order-'));
    const databasePath = path.join(directory, 'history.sqlite');
    let db = openDatabase(databasePath);
    t.after(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
    let sessions = new SqliteSessionRepository(db);
    let snapshots = new SqliteSnapshotRepository(db);
    const tracker = new GameSessionTracker({ sessions, snapshots, createId: () => 'public-order-session' });
    const first = validateSnapshot(rawSnapshot(10, [1, 0.9951444]));
    const later = validateSnapshot(rawSnapshot(11, [0.72, 0.38]));
    await tracker.handleSnapshot(first);
    await tracker.handleSnapshot(later);
    await tracker.flush();
    assert.equal(db.prepare<[string, number], { public_order: number }>(
      'SELECT public_order FROM country_snapshots WHERE session_id = ? AND day = ? AND country_id = \'russia\'',
    ).get('public-order-session', 10)?.public_order, 0.9951444);
    db.close();

    db = openDatabase(databasePath);
    sessions = new SqliteSessionRepository(db);
    snapshots = new SqliteSnapshotRepository(db);
    const restored = new GameSessionTracker({ sessions, snapshots });
    await restored.initialize();
    const app = buildApi({ tracker: restored, sessions, snapshots,
      collector: { getStatus: () => ({ state: 'running', pid: 1, startedAt: null,
        lastSnapshotAt: later.capturedAt, lastDiseaseTurn: 11, lastError: null, exit: null }),
      getLatestSnapshot: () => later },
      liveEvents: { onLiveSnapshot: () => () => {}, onStatus: () => () => {} } });
    t.after(() => app.close());

    const live = await app.inject('/api/v1/live');
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json().snapshot.countries.map((country: { publicOrder: number }) => country.publicOrder),
      [0.72, 0.38]);
    const earlier = await app.inject('/api/v1/sessions/public-order-session/days/10');
    const latest = await app.inject('/api/v1/sessions/public-order-session/days/11');
    assert.equal(earlier.statusCode, 200);
    assert.equal(latest.statusCode, 200);
    assert.deepEqual(earlier.json().countries.map((country: { publicOrder: number }) => country.publicOrder),
      [1, 0.9951444]);
    assert.deepEqual(latest.json().countries.map((country: { publicOrder: number }) => country.publicOrder),
      [0.72, 0.38]);
    assert.equal((await app.inject('/api/v1/sessions/public-order-session/days/11'))
      .json().countries[1].publicOrder, 0.38);
  });
